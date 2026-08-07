process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { JSONObject } from "Common/Types/JSON";
import {
  DomainLookupError,
  DomainLookupErrorUtil,
  DomainLookupUnsupportedError,
  DomainNotFoundError,
} from "../../../Utils/Domain/DomainLookupError";
import RdapBootstrap from "../../../Utils/Domain/RdapBootstrap";
import RdapHttp from "../../../Utils/Domain/RdapHttp";
import RdapLookup, { RdapLookupResult } from "../../../Utils/Domain/RdapLookup";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const IDENTITY_DIGITAL_RDAP: JSONObject = {
  ldhName: "identity.digital",
  status: ["client transfer prohibited"],
  events: [
    { eventAction: "registration", eventDate: "2014-09-10T16:00:01.587Z" },
    { eventAction: "expiration", eventDate: "2026-09-10T16:00:01.587Z" },
  ],
  nameservers: [{ ldhName: "ns-525.awsdns-01.net" }],
  entities: [
    {
      roles: ["registrar"],
      vcardArray: ["vcard", [["fn", {}, "text", "Name.com, Inc."]]],
    },
  ],
};

const IDENTITY_DIGITAL_BASE_URL: string =
  "https://rdap.identitydigital.services/rdap/";

describe("RdapLookup", () => {
  // eslint-disable-next-line @typescript-eslint/typedef
  let getJsonSpy = jest.spyOn(RdapHttp, "getJson");
  // eslint-disable-next-line @typescript-eslint/typedef
  let bootstrapSpy = jest.spyOn(RdapBootstrap, "getServiceUrlsForDomain");

  beforeEach(() => {
    bootstrapSpy = jest
      .spyOn(RdapBootstrap, "getServiceUrlsForDomain")
      .mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [IDENTITY_DIGITAL_BASE_URL],
      } as never);

    getJsonSpy = jest.spyOn(RdapHttp, "getJson").mockResolvedValue({
      statusCode: 200,
      body: IDENTITY_DIGITAL_RDAP,
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The whole point of issue #3046: .digital's WHOIS host answers "TLD is not
   * supported.", while its RDAP service returns a complete record.
   */
  it("reads a full record for a TLD whose WHOIS server is dead", async () => {
    const result: RdapLookupResult = await RdapLookup.lookup(
      "identity.digital",
      { timeoutInMs: 5000 },
    );

    expect(result.record.domainName).toBe("identity.digital");
    expect(result.record.expiresDate).toBe("2026-09-10T16:00:01.587Z");
    expect(result.record.registrar).toBe("Name.com, Inc.");
    expect(result.rdapServerUrl).toBe(IDENTITY_DIGITAL_BASE_URL);
  });

  it("queries {baseUrl}domain/{name}", async () => {
    await RdapLookup.lookup("identity.digital", { timeoutInMs: 5000 });

    expect(getJsonSpy.mock.calls[0]![0]).toBe(
      "https://rdap.identitydigital.services/rdap/domain/identity.digital",
    );
  });

  it("passes the configured timeout down to the request", async () => {
    await RdapLookup.lookup("identity.digital", { timeoutInMs: 1234 });

    expect(getJsonSpy.mock.calls[0]![1]).toEqual({ timeoutInMs: 1234 });
    expect(bootstrapSpy.mock.calls[0]![1]).toEqual({ timeoutInMs: 1234 });
  });

  describe("when the TLD publishes no RDAP service", () => {
    beforeEach(() => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [],
      } as never);
    });

    it("throws DomainLookupUnsupportedError", async () => {
      await expect(
        RdapLookup.lookup("example.io", { timeoutInMs: 5000 }),
      ).rejects.toBeInstanceOf(DomainLookupUnsupportedError);
    });

    it("names the TLD and points at the other lookup methods", async () => {
      await expect(
        RdapLookup.lookup("example.io", { timeoutInMs: 5000 }),
      ).rejects.toThrow(/\.io/);
      await expect(
        RdapLookup.lookup("example.io", { timeoutInMs: 5000 }),
      ).rejects.toThrow(/WHOIS or Auto/);
    });

    it("does not make an RDAP request", async () => {
      await RdapLookup.lookup("example.io", { timeoutInMs: 5000 }).catch(
        (): void => {},
      );

      expect(getJsonSpy).not.toHaveBeenCalled();
    });

    it("is not retryable - a missing RDAP service will not appear on a retry", async () => {
      const err: unknown = await RdapLookup.lookup("example.io", {
        timeoutInMs: 5000,
      }).catch((caught: unknown): unknown => {
        return caught;
      });

      expect(DomainLookupErrorUtil.isRetryable(err)).toBe(false);
    });
  });

  /*
   * Not reaching IANA is a fact about the network, not about the TLD.
   * Reporting it as "no RDAP service" would be untrue AND permanent, and a
   * permanent verdict skips retries and the probe-connectivity gate - so one
   * data.iana.org outage would fire an incident on every domain monitor on
   * the probe.
   */
  describe("when the IANA bootstrap registry is unreachable", () => {
    beforeEach(() => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: false,
        serviceUrls: [],
      } as never);
    });

    it("is retryable, unlike a TLD that genuinely has no RDAP service", async () => {
      const err: unknown = await RdapLookup.lookup("example.com", {
        timeoutInMs: 5000,
      }).catch((caught: unknown): unknown => {
        return caught;
      });

      expect(DomainLookupErrorUtil.isRetryable(err)).toBe(true);
      expect(err).not.toBeInstanceOf(DomainLookupUnsupportedError);
    });

    it("does not claim the TLD publishes no RDAP service", async () => {
      await expect(
        RdapLookup.lookup("example.com", { timeoutInMs: 5000 }),
      ).rejects.toThrow(/bootstrap registry/);
      await expect(
        RdapLookup.lookup("example.com", { timeoutInMs: 5000 }),
      ).rejects.not.toThrow(/No RDAP service is published/);
    });
  });

  describe("HTTP status handling", () => {
    it("treats 404 as an authoritative 'not registered'", async () => {
      getJsonSpy.mockResolvedValue({ statusCode: 404, body: null } as never);

      await expect(
        RdapLookup.lookup("not-registered.digital", { timeoutInMs: 5000 }),
      ).rejects.toBeInstanceOf(DomainNotFoundError);
    });

    it("does not retry a 404 - the answer will not change", async () => {
      getJsonSpy.mockResolvedValue({ statusCode: 404, body: null } as never);

      const err: unknown = await RdapLookup.lookup("not-registered.digital", {
        timeoutInMs: 5000,
      }).catch((caught: unknown): unknown => {
        return caught;
      });

      expect(DomainLookupErrorUtil.isRetryable(err)).toBe(false);
    });

    it("treats a 5xx as a retryable failure", async () => {
      getJsonSpy.mockResolvedValue({ statusCode: 503, body: null } as never);

      const err: unknown = await RdapLookup.lookup("identity.digital", {
        timeoutInMs: 5000,
      }).catch((caught: unknown): unknown => {
        return caught;
      });

      expect(err).toBeInstanceOf(DomainLookupError);
      expect(DomainLookupErrorUtil.isRetryable(err)).toBe(true);
      expect(DomainLookupErrorUtil.getMessage(err)).toContain("503");
    });

    it("treats a rate-limit response as a retryable failure", async () => {
      getJsonSpy.mockResolvedValue({ statusCode: 429, body: null } as never);

      const err: unknown = await RdapLookup.lookup("identity.digital", {
        timeoutInMs: 5000,
      }).catch((caught: unknown): unknown => {
        return caught;
      });

      expect(DomainLookupErrorUtil.isRetryable(err)).toBe(true);
    });

    it("rejects a 200 that carries no registration data", async () => {
      getJsonSpy.mockResolvedValue({
        statusCode: 200,
        body: { rdapConformance: ["rdap_level_0"], notices: [] },
      } as never);

      await expect(
        RdapLookup.lookup("identity.digital", { timeoutInMs: 5000 }),
      ).rejects.toThrow(/without any registration data/);
    });
  });

  describe("when a TLD publishes more than one RDAP server", () => {
    beforeEach(() => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: ["https://primary.example/", "https://secondary.example/"],
      } as never);
    });

    it("falls through to the next server when the first one fails", async () => {
      getJsonSpy
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED") as never)
        .mockResolvedValueOnce({
          statusCode: 200,
          body: IDENTITY_DIGITAL_RDAP,
        } as never);

      const result: RdapLookupResult = await RdapLookup.lookup(
        "identity.digital",
        { timeoutInMs: 5000 },
      );

      expect(result.rdapServerUrl).toBe("https://secondary.example/");
      expect(getJsonSpy).toHaveBeenCalledTimes(2);
    });

    it("stops at a 404 instead of asking the next server", async () => {
      getJsonSpy.mockResolvedValue({ statusCode: 404, body: null } as never);

      await expect(
        RdapLookup.lookup("identity.digital", { timeoutInMs: 5000 }),
      ).rejects.toBeInstanceOf(DomainNotFoundError);
      expect(getJsonSpy).toHaveBeenCalledTimes(1);
    });

    it("surfaces the last failure when every server fails", async () => {
      getJsonSpy
        .mockRejectedValueOnce(new Error("first server down") as never)
        .mockRejectedValueOnce(new Error("second server down") as never);

      await expect(
        RdapLookup.lookup("identity.digital", { timeoutInMs: 5000 }),
      ).rejects.toThrow("second server down");
    });
  });
});
