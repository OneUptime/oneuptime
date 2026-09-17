process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  DomainLookupErrorUtil,
  DomainLookupUnsupportedError,
  DomainNotFoundError,
} from "../../../Utils/Domain/DomainLookupError";
import { DomainRecord } from "../../../Utils/Domain/DomainRecord";
import WhoisLookup from "../../../Utils/Domain/WhoisLookup";
import {
  WhoisMockCall,
  __getWhoisCalls,
  __resetWhoisMock,
  __setWhoisError,
  __setWhoisResponse,
} from "../../__mocks__/whois-json";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Captured verbatim from `whois-json("oneuptime.com")`. Two things about it
 * matter: whois-json joins repeated "Name Server:" lines into one
 * space-separated string, and the expiry arrives under the registrar's key
 * (registrarRegistrationExpirationDate) rather than the registry's.
 */
const WORKING_COM_RESPONSE: Record<string, unknown> = {
  domainName: "ONEUPTIME.COM",
  registryDomainId: "2654109619_DOMAIN_COM-VRSN",
  registrarWhoisServer: "whois.cloudflare.com",
  registrar: "Cloudflare, Inc.",
  registrarUrl: "https://www.cloudflare.com",
  updatedDate: "2022-03-18T13:27:06Z",
  creationDate: "2021-11-10T20:55:40Z",
  registrarRegistrationExpirationDate: "2031-11-10T20:55:40Z",
  domainStatus:
    "clienttransferprohibited https://icann.org/epp#clienttransferprohibited",
  nameServer: "alla.ns.cloudflare.com bill.ns.cloudflare.com",
  dnssec: "signedDelegation",
  registrantName: "DATA REDACTED",
};

/*
 * Captured verbatim from `whois-json("identity.digital")`. This is issue
 * #3046: whois.donuts.co - still the mapped WHOIS host for .digital and
 * every other Identity Digital TLD - replies "TLD is not supported." plus a
 * terms-of-use blob. Neither line parses into a registration field, so the
 * call resolves with an object that says nothing about the domain.
 */
const TLD_NOT_SUPPORTED_RESPONSE: Record<string, unknown> = {
  lastUpdateOfWhoisDatabase: "2026-08-07T07:45:25Z <<<",
  termsOfUse:
    "Access to WHOIS information is provided to assist persons in determining the contents of a domain name registration record in the registry database.",
};

describe("WhoisLookup", () => {
  beforeEach(() => {
    __resetWhoisMock();
  });

  afterEach(() => {
    __resetWhoisMock();
  });

  describe("a working gTLD response", () => {
    beforeEach(() => {
      __setWhoisResponse(WORKING_COM_RESPONSE);
    });

    it("lowercases the domain name", async () => {
      const record: DomainRecord = await WhoisLookup.lookup("oneuptime.com", {
        timeoutInMs: 5000,
      });

      expect(record.domainName).toBe("oneuptime.com");
    });

    it("reads the registrar and its URL", async () => {
      const record: DomainRecord = await WhoisLookup.lookup("oneuptime.com", {
        timeoutInMs: 5000,
      });

      expect(record.registrar).toBe("Cloudflare, Inc.");
      expect(record.registrarUrl).toBe("https://www.cloudflare.com");
    });

    it("normalizes the dates to ISO 8601", async () => {
      const record: DomainRecord = await WhoisLookup.lookup("oneuptime.com", {
        timeoutInMs: 5000,
      });

      expect(record.createdDate).toBe("2021-11-10T20:55:40.000Z");
      expect(record.updatedDate).toBe("2022-03-18T13:27:06.000Z");
      expect(record.expiresDate).toBe("2031-11-10T20:55:40.000Z");
    });

    it("splits the space-joined name server blob", async () => {
      const record: DomainRecord = await WhoisLookup.lookup("oneuptime.com", {
        timeoutInMs: 5000,
      });

      expect(record.nameServers).toEqual([
        "alla.ns.cloudflare.com",
        "bill.ns.cloudflare.com",
      ]);
    });

    it("drops the EPP status URL", async () => {
      const record: DomainRecord = await WhoisLookup.lookup("oneuptime.com", {
        timeoutInMs: 5000,
      });

      expect(record.domainStatus).toEqual(["clienttransferprohibited"]);
    });

    it("reads DNSSEC", async () => {
      const record: DomainRecord = await WhoisLookup.lookup("oneuptime.com", {
        timeoutInMs: 5000,
      });

      expect(record.dnssec).toBe("signedDelegation");
    });
  });

  describe("a retired WHOIS server that answers without a record", () => {
    beforeEach(() => {
      __setWhoisResponse(TLD_NOT_SUPPORTED_RESPONSE);
    });

    // Regression for issue #3046 - this used to resolve as a healthy monitor.
    it("fails instead of reporting an empty record as a success", async () => {
      await expect(
        WhoisLookup.lookup("identity.digital", { timeoutInMs: 5000 }),
      ).rejects.toThrow(/without any registration data/);
    });

    it("explains what happened and what to do about it", async () => {
      await expect(
        WhoisLookup.lookup("identity.digital", { timeoutInMs: 5000 }),
      ).rejects.toThrow(/RDAP or Auto/);
    });

    /*
     * A content-less reply is also what a registrar sends while rate
     * limiting or briefly broken, and those cases are indistinguishable
     * here. Classifying it permanent would open an incident on the first
     * blip without even a retry, so it stays retryable; a genuinely dead TLD
     * simply exhausts its attempts and is reported then.
     */
    it("is retryable, because a rate-limited registrar looks the same", async () => {
      const err: unknown = await WhoisLookup.lookup("identity.digital", {
        timeoutInMs: 5000,
      }).catch((caught: unknown): unknown => {
        return caught;
      });

      expect(DomainLookupErrorUtil.isRetryable(err)).toBe(true);
      expect(err).not.toBeInstanceOf(DomainLookupUnsupportedError);
    });

    it("also fails on a completely empty response", async () => {
      __setWhoisResponse({});

      await expect(
        WhoisLookup.lookup("identity.digital", { timeoutInMs: 5000 }),
      ).rejects.toThrow(/without any registration data/);
    });

    it("also fails when the library resolves with null", async () => {
      __setWhoisResponse(null);

      await expect(
        WhoisLookup.lookup("identity.digital", { timeoutInMs: 5000 }),
      ).rejects.toThrow(/without any registration data/);
    });
  });

  /*
   * The other half of what a domain monitor exists to detect. DENIC echoes
   * the name back with "Status: free" for an unregistered domain, which has
   * fields and would otherwise read as a healthy registration.
   */
  describe("a domain that is not registered", () => {
    it("reports DENIC's 'free' answer as not registered", async () => {
      __setWhoisResponse({ domain: "nichtregistriert.de", status: "free" });

      await expect(
        WhoisLookup.lookup("nichtregistriert.de", { timeoutInMs: 5000 }),
      ).rejects.toBeInstanceOf(DomainNotFoundError);
    });

    it("says so plainly", async () => {
      __setWhoisResponse({ domain: "nichtregistriert.de", status: "free" });

      await expect(
        WhoisLookup.lookup("nichtregistriert.de", { timeoutInMs: 5000 }),
      ).rejects.toThrow(/not registered/);
    });

    it("does not retry - the answer will not change", async () => {
      __setWhoisResponse({ domain: "example.test", status: "AVAILABLE" });

      const err: unknown = await WhoisLookup.lookup("example.test", {
        timeoutInMs: 5000,
      }).catch((caught: unknown): unknown => {
        return caught;
      });

      expect(DomainLookupErrorUtil.isRetryable(err)).toBe(false);
    });
  });

  describe("options passed to whois-json", () => {
    beforeEach(() => {
      __setWhoisResponse(WORKING_COM_RESPONSE);
    });

    /*
     * The monitor's Timeout setting used to be dropped on the floor, leaving
     * a WHOIS socket with no deadline at all.
     */
    it("passes the configured timeout through", async () => {
      await WhoisLookup.lookup("oneuptime.com", { timeoutInMs: 4321 });

      const calls: Array<WhoisMockCall> = __getWhoisCalls();

      expect(calls).toHaveLength(1);
      expect(calls[0]!.domain).toBe("oneuptime.com");
      expect(calls[0]!.options).toEqual({ timeout: 4321, follow: 2 });
    });
  });

  describe("registry-specific field names", () => {
    it("reads the registry expiry key", async () => {
      __setWhoisResponse({
        domainName: "example.com",
        registryExpiryDate: "2030-05-06T07:08:09Z",
      });

      const record: DomainRecord = await WhoisLookup.lookup("example.com", {
        timeoutInMs: 5000,
      });

      expect(record.expiresDate).toBe("2030-05-06T07:08:09.000Z");
    });

    it("reads the .ru/.su style paid-till key", async () => {
      __setWhoisResponse({
        domain: "EXAMPLE.RU",
        paidTill: "2030-01-01T21:00:00Z",
        nserver: "ns1.example.ru ns2.example.ru",
        state: "REGISTERED, DELEGATED, VERIFIED",
      });

      const record: DomainRecord = await WhoisLookup.lookup("example.ru", {
        timeoutInMs: 5000,
      });

      expect(record.domainName).toBe("example.ru");
      expect(record.expiresDate).toBe("2030-01-01T21:00:00.000Z");
      expect(record.nameServers).toEqual(["ns1.example.ru", "ns2.example.ru"]);
      expect(record.domainStatus).toEqual([
        "REGISTERED",
        "DELEGATED",
        "VERIFIED",
      ]);
    });

    it("accepts a DENIC style record with no expiry at all", async () => {
      __setWhoisResponse({
        domain: "example.de",
        status: "connect",
        changed: "2024-02-03T10:11:12Z",
      });

      const record: DomainRecord = await WhoisLookup.lookup("example.de", {
        timeoutInMs: 5000,
      });

      expect(record.expiresDate).toBeUndefined();
      expect(record.domainStatus).toEqual(["connect"]);
      expect(record.updatedDate).toBe("2024-02-03T10:11:12.000Z");
    });
  });

  describe("a followed referral chain", () => {
    /*
     * Precedence has to be asserted on a key both hops carry and disagree
     * on, otherwise the test passes whichever way the merge runs.
     */
    it("lets the earlier (registry) hop win a key both hops set", async () => {
      __setWhoisResponse([
        {
          server: "whois.verisign-grs.com",
          data: {
            domainName: "EXAMPLE.COM",
            registrar: "Registry Says This",
            registryExpiryDate: "2030-01-01T00:00:00Z",
          },
        },
        {
          server: "whois.registrar.example",
          data: {
            domainName: "example.com",
            registrar: "Registrar Says That",
            registryExpiryDate: "2999-01-01T00:00:00Z",
            nameServer: "ns1.example.com",
          },
        },
      ]);

      const record: DomainRecord = await WhoisLookup.lookup("example.com", {
        timeoutInMs: 5000,
      });

      expect(record.registrar).toBe("Registry Says This");
      expect(record.expiresDate).toBe("2030-01-01T00:00:00.000Z");
    });

    it("lets a later hop fill a key the earlier one left out", async () => {
      __setWhoisResponse([
        {
          server: "whois.verisign-grs.com",
          data: { domainName: "EXAMPLE.COM" },
        },
        {
          server: "whois.registrar.example",
          data: {
            registrar: "Only The Registrar Knows",
            nameServer: "ns1.example.com",
          },
        },
      ]);

      const record: DomainRecord = await WhoisLookup.lookup("example.com", {
        timeoutInMs: 5000,
      });

      expect(record.domainName).toBe("example.com");
      expect(record.registrar).toBe("Only The Registrar Knows");
      expect(record.nameServers).toEqual(["ns1.example.com"]);
    });

    it("handles array entries that are plain records", async () => {
      __setWhoisResponse([
        { domainName: "example.com", registrar: "Flat Array Registrar" },
      ]);

      const record: DomainRecord = await WhoisLookup.lookup("example.com", {
        timeoutInMs: 5000,
      });

      expect(record.registrar).toBe("Flat Array Registrar");
    });
  });

  describe("transport failures", () => {
    it("propagates the error so the caller can retry it", async () => {
      __setWhoisError(new Error("connect ETIMEDOUT 192.0.2.1:43"));

      await expect(
        WhoisLookup.lookup("example.com", { timeoutInMs: 5000 }),
      ).rejects.toThrow("connect ETIMEDOUT 192.0.2.1:43");
    });
  });
});
