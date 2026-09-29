process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { JSONObject } from "Common/Types/JSON";
import RdapBootstrap, {
  BOOTSTRAP_CACHE_TTL_IN_MS,
  BOOTSTRAP_FAILURE_CACHE_TTL_IN_MS,
  BOOTSTRAP_FETCH_TIMEOUT_IN_MS,
  IANA_RDAP_BOOTSTRAP_URL,
  RdapBootstrapResult,
} from "../../../Utils/Domain/RdapBootstrap";
import RdapHttp, { RdapHttpResponse } from "../../../Utils/Domain/RdapHttp";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A trimmed copy of https://data.iana.org/rdap/dns.json. ".digital" really is
 * served by Identity Digital's RDAP endpoint, and ".io" really is absent from
 * the registry - which is why Auto has to fall back to WHOIS for it.
 */
const BOOTSTRAP_DOCUMENT: JSONObject = {
  version: "1.0",
  publication: "2026-07-23T02:00:03Z",
  services: [
    [
      ["digital", "email", "life", "zone"],
      ["https://rdap.identitydigital.services/rdap/"],
    ],
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["example"], ["http://rdap-legacy.example/", "https://rdap.example/"]],
    [["noslash"], ["https://rdap.noslash.example/rdap"]],
  ],
};

const okResponse: (body: JSONObject) => RdapHttpResponse = (
  body: JSONObject,
): RdapHttpResponse => {
  return { statusCode: 200, body: body };
};

describe("RdapBootstrap", () => {
  // eslint-disable-next-line @typescript-eslint/typedef
  let getJsonSpy = jest.spyOn(RdapHttp, "getJson");
  let nowInMs: number = 1_700_000_000_000;

  beforeEach(() => {
    RdapBootstrap.clearCache();

    nowInMs = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return nowInMs;
    });

    getJsonSpy = jest
      .spyOn(RdapHttp, "getJson")
      .mockResolvedValue(okResponse(BOOTSTRAP_DOCUMENT) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    RdapBootstrap.clearCache();
  });

  describe("parseBootstrapDocument", () => {
    it("maps every suffix in a service entry to its base URLs", () => {
      const registry: Map<
        string,
        Array<string>
      > = RdapBootstrap.parseBootstrapDocument(BOOTSTRAP_DOCUMENT);

      expect(registry.get("digital")).toEqual([
        "https://rdap.identitydigital.services/rdap/",
      ]);
      expect(registry.get("zone")).toEqual([
        "https://rdap.identitydigital.services/rdap/",
      ]);
      expect(registry.get("com")).toEqual([
        "https://rdap.verisign.com/com/v1/",
      ]);
    });

    it("prefers HTTPS endpoints over plain HTTP", () => {
      const registry: Map<
        string,
        Array<string>
      > = RdapBootstrap.parseBootstrapDocument(BOOTSTRAP_DOCUMENT);

      expect(registry.get("example")).toEqual([
        "https://rdap.example/",
        "http://rdap-legacy.example/",
      ]);
    });

    it("appends the trailing slash the base URL is supposed to have", () => {
      const registry: Map<
        string,
        Array<string>
      > = RdapBootstrap.parseBootstrapDocument(BOOTSTRAP_DOCUMENT);

      expect(registry.get("noslash")).toEqual([
        "https://rdap.noslash.example/rdap/",
      ]);
    });

    it("normalizes suffix casing and stray dots", () => {
      const registry: Map<
        string,
        Array<string>
      > = RdapBootstrap.parseBootstrapDocument({
        services: [[[".DIGITAL."], ["https://rdap.example/"]]],
      });

      expect(registry.get("digital")).toEqual(["https://rdap.example/"]);
    });

    it("merges entries that claim the same suffix", () => {
      const registry: Map<
        string,
        Array<string>
      > = RdapBootstrap.parseBootstrapDocument({
        services: [
          [["test"], ["https://a.example/"]],
          [["test"], ["https://b.example/"]],
        ],
      });

      expect(registry.get("test")).toEqual([
        "https://a.example/",
        "https://b.example/",
      ]);
    });

    it("skips malformed service entries instead of throwing", () => {
      const registry: Map<
        string,
        Array<string>
      > = RdapBootstrap.parseBootstrapDocument({
        services: [
          "not-an-entry",
          [["onlysuffixes"]],
          [["bad"], "not-an-array"],
          [["nourls"], []],
          [["skipped"], ["ftp://rdap.example/"]],
          [[42], ["https://rdap.example/"]],
          [["good"], ["https://rdap.example/"]],
        ],
      } as unknown as JSONObject);

      expect(registry.get("good")).toEqual(["https://rdap.example/"]);
      expect(registry.get("onlysuffixes")).toBeUndefined();
      expect(registry.get("bad")).toBeUndefined();
      expect(registry.get("nourls")).toBeUndefined();
      expect(registry.get("skipped")).toBeUndefined();
      expect(registry.size).toBe(1);
    });

    it("returns an empty registry for a document with no services", () => {
      expect(RdapBootstrap.parseBootstrapDocument({}).size).toBe(0);
      expect(RdapBootstrap.parseBootstrapDocument(null).size).toBe(0);
    });
  });

  describe("getServiceUrlsForDomain", () => {
    it("fetches the IANA bootstrap registry", async () => {
      await RdapBootstrap.getServiceUrlsForDomain("identity.digital");

      expect(getJsonSpy).toHaveBeenCalledTimes(1);
      expect(getJsonSpy.mock.calls[0]![0]).toBe(IANA_RDAP_BOOTSTRAP_URL);
    });

    // The regression for issue #3046: .digital does have an RDAP service.
    it("resolves the RDAP service for .digital", async () => {
      await expect(
        RdapBootstrap.getServiceUrlsForDomain("identity.digital"),
      ).resolves.toEqual({
        isRegistryAvailable: true,
        serviceUrls: ["https://rdap.identitydigital.services/rdap/"],
      });
    });

    it("matches on the TLD regardless of how many labels precede it", async () => {
      await expect(
        RdapBootstrap.getServiceUrlsForDomain("a.b.c.example.com"),
      ).resolves.toEqual({
        isRegistryAvailable: true,
        serviceUrls: ["https://rdap.verisign.com/com/v1/"],
      });
    });

    it("prefers the longest matching suffix", async () => {
      getJsonSpy.mockResolvedValue(
        okResponse({
          services: [
            [["uk"], ["https://rdap.nominet.example/"]],
            [["co.uk"], ["https://rdap.couk.example/"]],
          ],
        }) as never,
      );

      await expect(
        RdapBootstrap.getServiceUrlsForDomain("example.co.uk"),
      ).resolves.toEqual({
        isRegistryAvailable: true,
        serviceUrls: ["https://rdap.couk.example/"],
      });
    });

    it("is case insensitive", async () => {
      await expect(
        RdapBootstrap.getServiceUrlsForDomain("IDENTITY.DIGITAL"),
      ).resolves.toEqual({
        isRegistryAvailable: true,
        serviceUrls: ["https://rdap.identitydigital.services/rdap/"],
      });
    });

    /*
     * Roughly half the ccTLDs publish no RDAP service. That is not an error -
     * it is the signal that tells Auto to use WHOIS.
     */
    it("reports the registry as available but empty for a TLD with no RDAP service", async () => {
      await expect(
        RdapBootstrap.getServiceUrlsForDomain("example.io"),
      ).resolves.toEqual({ isRegistryAvailable: true, serviceUrls: [] });
    });
  });

  describe("caching", () => {
    it("fetches once and serves later lookups from cache", async () => {
      await RdapBootstrap.getServiceUrlsForDomain("a.com");
      await RdapBootstrap.getServiceUrlsForDomain("b.digital");
      await RdapBootstrap.getServiceUrlsForDomain("c.net");

      expect(getJsonSpy).toHaveBeenCalledTimes(1);
    });

    it("shares one in-flight fetch between concurrent lookups", async () => {
      await Promise.all([
        RdapBootstrap.getServiceUrlsForDomain("a.com"),
        RdapBootstrap.getServiceUrlsForDomain("b.digital"),
        RdapBootstrap.getServiceUrlsForDomain("c.net"),
      ]);

      expect(getJsonSpy).toHaveBeenCalledTimes(1);
    });

    it("refetches once the cache TTL has passed", async () => {
      await RdapBootstrap.getServiceUrlsForDomain("a.com");

      nowInMs += BOOTSTRAP_CACHE_TTL_IN_MS + 1;

      await RdapBootstrap.getServiceUrlsForDomain("a.com");

      expect(getJsonSpy).toHaveBeenCalledTimes(2);
    });

    it("clearCache forces a refetch", async () => {
      await RdapBootstrap.getServiceUrlsForDomain("a.com");
      RdapBootstrap.clearCache();
      await RdapBootstrap.getServiceUrlsForDomain("a.com");

      expect(getJsonSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the bootstrap registry cannot be read", () => {
    /*
     * The distinction that matters: "unavailable" must never be reported as
     * "this TLD has no RDAP service". The latter is permanent, and a
     * permanent verdict skips retries and the probe-connectivity gate - so a
     * data.iana.org outage would open an incident on every domain monitor.
     */
    it("reports the registry as unavailable rather than as an empty answer", async () => {
      getJsonSpy.mockRejectedValue(new Error("getaddrinfo ENOTFOUND") as never);

      await expect(
        RdapBootstrap.getServiceUrlsForDomain("identity.digital"),
      ).resolves.toEqual({ isRegistryAvailable: false, serviceUrls: [] });
    });

    it("treats a non-2xx response as unavailable", async () => {
      getJsonSpy.mockResolvedValue({ statusCode: 503, body: null } as never);

      await expect(
        RdapBootstrap.getServiceUrlsForDomain("identity.digital"),
      ).resolves.toEqual({ isRegistryAvailable: false, serviceUrls: [] });
    });

    it("treats a document listing no services as unavailable", async () => {
      getJsonSpy.mockResolvedValue(okResponse({ services: [] }) as never);

      await expect(
        RdapBootstrap.getServiceUrlsForDomain("identity.digital"),
      ).resolves.toEqual({ isRegistryAvailable: false, serviceUrls: [] });
    });

    it("does not retry on every check while the failure is cached", async () => {
      getJsonSpy.mockRejectedValue(new Error("network down") as never);

      await RdapBootstrap.getServiceUrlsForDomain("identity.digital");
      await RdapBootstrap.getServiceUrlsForDomain("identity.digital");
      await RdapBootstrap.getServiceUrlsForDomain("identity.digital");

      expect(getJsonSpy).toHaveBeenCalledTimes(1);
    });

    it("retries once the failure cache expires", async () => {
      getJsonSpy.mockRejectedValue(new Error("network down") as never);

      await RdapBootstrap.getServiceUrlsForDomain("identity.digital");

      nowInMs += BOOTSTRAP_FAILURE_CACHE_TTL_IN_MS + 1;

      getJsonSpy.mockResolvedValue(okResponse(BOOTSTRAP_DOCUMENT) as never);

      await expect(
        RdapBootstrap.getServiceUrlsForDomain("identity.digital"),
      ).resolves.toEqual({
        isRegistryAvailable: true,
        serviceUrls: ["https://rdap.identitydigital.services/rdap/"],
      });
      expect(getJsonSpy).toHaveBeenCalledTimes(2);
    });

    it("keeps serving a stale registry rather than nothing", async () => {
      await RdapBootstrap.getServiceUrlsForDomain("identity.digital");

      nowInMs += BOOTSTRAP_CACHE_TTL_IN_MS + 1;
      getJsonSpy.mockRejectedValue(new Error("network down") as never);

      await expect(
        RdapBootstrap.getServiceUrlsForDomain("identity.digital"),
      ).resolves.toEqual({
        isRegistryAvailable: true,
        serviceUrls: ["https://rdap.identitydigital.services/rdap/"],
      });
    });
  });

  describe("the shared fetch's timeout", () => {
    /*
     * The bootstrap document is fetched once for the whole probe, so it must
     * not inherit the timeout of whichever monitor happened to trigger it -
     * one monitor set to 2s would otherwise abort the ~200KB fetch for every
     * other monitor and poison the 5-minute failure cache.
     */
    it("is not shortened by a monitor with a small timeout", async () => {
      await RdapBootstrap.getServiceUrlsForDomain("identity.digital", {
        timeoutInMs: 2000,
      });

      expect(getJsonSpy.mock.calls[0]![1]).toEqual({
        timeoutInMs: BOOTSTRAP_FETCH_TIMEOUT_IN_MS,
      });
    });

    it("is extended by a monitor with a longer timeout", async () => {
      await RdapBootstrap.getServiceUrlsForDomain("identity.digital", {
        timeoutInMs: BOOTSTRAP_FETCH_TIMEOUT_IN_MS + 5000,
      });

      expect(getJsonSpy.mock.calls[0]![1]).toEqual({
        timeoutInMs: BOOTSTRAP_FETCH_TIMEOUT_IN_MS + 5000,
      });
    });
  });

  describe("result typing", () => {
    it("always reports both fields", async () => {
      const result: RdapBootstrapResult =
        await RdapBootstrap.getServiceUrlsForDomain("identity.digital");

      expect(result.isRegistryAvailable).toBe(true);
      expect(result.serviceUrls).toHaveLength(1);
    });
  });
});
