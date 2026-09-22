import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import URL from "../../../Types/API/URL";
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
 * SSRFProtection is the single guard standing between attacker-controlled
 * webhook URLs (any unauthenticated visitor can register a status page
 * subscriber webhook) and the server's outbound HTTP client. These tests pin
 * the blocklist so a regression cannot quietly re-open the path to the cloud
 * metadata endpoint or internal services. DNS is mocked so the resolution
 * branch is exercised deterministically and offline.
 */

/*
 * dns.promises.lookup is heavily overloaded, so spyOn resolves to the wrong
 * signature. Pin the one shape this module actually calls ({ all: true }).
 */
type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

describe("SSRFProtection.validateWebhookTargetIsSafe", () => {
  let lookupSpy: LookupSpy;

  beforeEach(() => {
    lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
    // Default: hostnames resolve to a public address unless a test overrides it.
    lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("blocks private, loopback, link-local and metadata literals", () => {
    const blockedUrls: Array<string> = [
      "http://127.0.0.1/webhook",
      "http://127.0.0.1:8080/webhook",
      "http://0.0.0.0/",
      "http://10.0.0.5/incident",
      "http://10.255.255.255/x",
      "http://172.16.0.1/",
      "http://172.31.255.1/",
      "http://192.168.1.1/hook",
      "http://100.64.0.1/",
      "http://100.127.255.255/",
      "http://localhost/",
      "http://localhost:3000/",
      "http://foo.localhost/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://[::1]/",
      "http://[::1]:8080/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[fd12:3456::1]/",
    ];

    test.each(blockedUrls)("rejects %s", async (url: string) => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(url),
      ).rejects.toThrow();
      expect(lookupSpy).not.toHaveBeenCalled();
    });
  });

  describe("blocks the cloud metadata endpoint, including port bypass", () => {
    test("rejects AWS metadata endpoint", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        ),
      ).rejects.toThrow();
    });

    test("rejects metadata endpoint with an explicit port (bypass attempt)", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://169.254.169.254:80/latest/meta-data/",
        ),
      ).rejects.toThrow();
      // Must be caught as a literal, never treated as a resolvable host.
      expect(lookupSpy).not.toHaveBeenCalled();
    });
  });

  describe("allows public destinations", () => {
    const allowedUrls: Array<string> = [
      "http://8.8.8.8/webhook",
      "https://1.1.1.1/",
      "http://172.15.0.1/", // just outside the private 172.16-31 range
      "http://172.32.0.1/",
      "http://100.63.0.1/", // just below CGNAT 100.64/10
      "http://100.128.0.1/", // just above CGNAT 100.64/10
    ];

    test.each(allowedUrls)("allows %s", async (url: string) => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(url),
      ).resolves.toBeUndefined();
    });

    test("allows a public hostname (DNS resolves to a public IP)", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "https://hooks.example.com/webhook",
        ),
      ).resolves.toBeUndefined();
      expect(lookupSpy).toHaveBeenCalledWith("hooks.example.com", {
        all: true,
      });
    });

    test("resolves a hostname even when a port is present", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "https://hooks.example.com:8443/webhook",
        ),
      ).resolves.toBeUndefined();
      // Port must be stripped so the hostname (not "host:port") is resolved.
      expect(lookupSpy).toHaveBeenCalledWith("hooks.example.com", {
        all: true,
      });
    });

    test("accepts a URL object as input", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          URL.fromString("http://8.8.8.8/webhook"),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("blocks hostnames that resolve to internal addresses", () => {
    test("rejects a hostname resolving to a private address (DNS rebinding)", async () => {
      lookupSpy.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "https://rebind.attacker.example/",
        ),
      ).rejects.toThrow();
    });

    test("rejects a hostname-with-port resolving to the metadata IP", async () => {
      lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "https://rebind.attacker.example:8080/",
        ),
      ).rejects.toThrow();
    });

    test("rejects when DNS resolution fails", async () => {
      lookupSpy.mockRejectedValue(new Error("ENOTFOUND"));

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "https://this-does-not-resolve.invalid/",
        ),
      ).rejects.toThrow();
    });
  });

  describe("rejects unusable URLs", () => {
    test("rejects a non-http(s) protocol", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("mongodb://8.8.8.8/"),
      ).rejects.toThrow("http or https");
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("ws://8.8.8.8/"),
      ).rejects.toThrow("http or https");
    });

    test("rejects a URL with no host", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("http:///no-host"),
      ).rejects.toThrow();
    });
  });
});

/*
 * The guard parses the target with OneUptime's URL type as well as WHATWG, and
 * turned any parse failure into "<label> is not a valid URL". That parser
 * refused a first path segment containing a ":" - every Telegram Bot API URL,
 * because the token is that segment - and any path containing "~". So the
 * sandboxed axios bridge refused perfectly public requests as invalid URLs.
 */
describe("SSRFProtection with a ':' or '~' in the path", () => {
  const BOT_TOKEN: string = "8000000001:AAFakeFakeFakeFakeFakeFakeFake_-12345";
  const TELEGRAM_URL: string = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  let lookupSpy: LookupSpy;

  beforeEach(() => {
    lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
    lookupSpy.mockResolvedValue([{ address: "149.154.167.220", family: 4 }]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("validateWebhookTargetIsSafe accepts a Telegram Bot API URL", async () => {
    await expect(
      SSRFProtection.validateWebhookTargetIsSafe(TELEGRAM_URL, {
        targetLabel: "Request URL",
      }),
    ).resolves.toBeUndefined();

    expect(lookupSpy).toHaveBeenCalledWith("api.telegram.org", { all: true });
  });

  test("validateWebhookTargetIsSafe accepts the same URL as a URL object", async () => {
    await expect(
      SSRFProtection.validateWebhookTargetIsSafe(URL.fromString(TELEGRAM_URL)),
    ).resolves.toBeUndefined();
  });

  test("validateAndResolveWebhookTarget keeps the token path and pins the address", async () => {
    const target: Awaited<
      ReturnType<typeof SSRFProtection.validateAndResolveWebhookTarget>
    > = await SSRFProtection.validateAndResolveWebhookTarget(TELEGRAM_URL, {
      targetLabel: "Request URL",
    });

    expect(target.url.toString()).toBe(TELEGRAM_URL);
    expect(target.url.pathname).toBe(`/bot${BOT_TOKEN}/sendMessage`);
    expect(target.addresses).toEqual([
      { address: "149.154.167.220", family: 4 },
    ]);
  });

  test.each([
    "https://example.com/~user/hook",
    "https://example.com/urn:uuid:6e8bc430-9c3a/x",
    "https://example.com/abc:def",
  ])("accepts the public URL %s", async (rawUrl: string) => {
    await expect(
      SSRFProtection.validateAndResolveWebhookTarget(rawUrl, {
        targetLabel: "Request URL",
      }),
    ).resolves.toMatchObject({ url: new globalThis.URL(rawUrl) });
  });

  test.each([
    [
      "the metadata endpoint",
      `http://169.254.169.254/bot${BOT_TOKEN}/sendMessage`,
    ],
    ["loopback", `http://127.0.0.1:8080/bot${BOT_TOKEN}/sendMessage`],
    ["an RFC-1918 address", `http://10.0.0.5/bot${BOT_TOKEN}/sendMessage`],
    ["IPv6 loopback", `http://[::1]/bot${BOT_TOKEN}/sendMessage`],
  ])(
    "still refuses %s behind a token path, for its host",
    async (_label: string, rawUrl: string) => {
      const validation: Promise<unknown> =
        SSRFProtection.validateAndResolveWebhookTarget(rawUrl, {
          targetLabel: "Request URL",
        });

      await expect(validation).rejects.toThrow(/private|loopback|link-local/);
      await expect(validation).rejects.not.toThrow(/not a valid URL/);
    },
  );

  test("still refuses a public name that resolves internally behind a token path", async () => {
    lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    await expect(
      SSRFProtection.validateAndResolveWebhookTarget(TELEGRAM_URL, {
        targetLabel: "Request URL",
      }),
    ).rejects.toThrow(/resolves to a private, loopback, or link-local/);
  });

  test("a refusal does not quote the token", async () => {
    let message: string = "";

    try {
      await SSRFProtection.validateAndResolveWebhookTarget(
        `http://169.254.169.254/bot${BOT_TOKEN}/sendMessage`,
        { targetLabel: "Request URL" },
      );
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).not.toBe("");
    expect(message).not.toContain(BOT_TOKEN);
  });
});
