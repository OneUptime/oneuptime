process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import DomainLookupMethod from "Common/Types/Monitor/DomainMonitor/DomainLookupMethod";
import DomainMonitorResponse from "Common/Types/Monitor/DomainMonitor/DomainMonitorResponse";
import MonitorStepDomainMonitor from "Common/Types/Monitor/MonitorStepDomainMonitor";
import { JSONObject } from "Common/Types/JSON";
import Sleep from "Common/Types/Sleep";
import logger from "Common/Server/Utils/Logger";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import RdapBootstrap from "../../../../Utils/Domain/RdapBootstrap";
import RdapHttp from "../../../../Utils/Domain/RdapHttp";
import DomainMonitorUtil from "../../../../Utils/Monitors/MonitorTypes/DomainMonitor";
import {
  WhoisMockCall,
  __getWhoisCalls,
  __resetWhoisMock,
  __setWhoisError,
  __setWhoisResponse,
} from "../../../__mocks__/whois-json";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const RDAP_BASE_URL: string = "https://rdap.identitydigital.services/rdap/";

const RDAP_RESPONSE: JSONObject = {
  ldhName: "identity.digital",
  status: ["client transfer prohibited"],
  events: [
    { eventAction: "registration", eventDate: "2014-09-10T16:00:01.587Z" },
    { eventAction: "expiration", eventDate: "2026-09-10T16:00:01.587Z" },
  ],
  nameservers: [{ ldhName: "NS-525.AWSDNS-01.NET" }],
  secureDNS: { delegationSigned: false },
  entities: [
    {
      roles: ["registrar"],
      vcardArray: ["vcard", [["fn", {}, "text", "Name.com, Inc."]]],
    },
  ],
};

/*
 * What whois.donuts.co actually returns for any .digital domain: a database
 * timestamp and a terms-of-use blob, with the "TLD is not supported." line
 * dropped by the parser because it has no colon. Issue #3046.
 */
const TLD_NOT_SUPPORTED_WHOIS: Record<string, unknown> = {
  lastUpdateOfWhoisDatabase: "2026-08-07T07:45:25Z <<<",
  termsOfUse: "Access to WHOIS information is provided to assist persons.",
};

const WORKING_WHOIS: Record<string, unknown> = {
  domainName: "EXAMPLE.IO",
  registrar: "Example Registrar Ltd",
  creationDate: "2015-01-02T03:04:05Z",
  registryExpiryDate: "2030-01-02T03:04:05Z",
  nameServer: "ns1.example.io ns2.example.io",
  domainStatus: "clientTransferProhibited https://icann.org/epp#x",
};

function buildConfig(input?: {
  domainName?: string;
  lookupMethod?: DomainLookupMethod;
  timeout?: number;
  retries?: number;
}): MonitorStepDomainMonitor {
  return {
    domainName: input?.domainName ?? "identity.digital",
    lookupMethod: input?.lookupMethod ?? DomainLookupMethod.Auto,
    timeout: input?.timeout ?? 5000,
    retries: input?.retries ?? 3,
  };
}

describe("DomainMonitorUtil.query", () => {
  // eslint-disable-next-line @typescript-eslint/typedef
  let bootstrapSpy = jest.spyOn(RdapBootstrap, "getServiceUrlsForDomain");
  // eslint-disable-next-line @typescript-eslint/typedef
  let getJsonSpy = jest.spyOn(RdapHttp, "getJson");

  beforeEach(() => {
    __resetWhoisMock();

    // The retry backoff is real seconds otherwise.
    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);

    // Every failure path logs; keep the suite output readable.
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});

    bootstrapSpy = jest
      .spyOn(RdapBootstrap, "getServiceUrlsForDomain")
      .mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [RDAP_BASE_URL],
      } as never);

    getJsonSpy = jest
      .spyOn(RdapHttp, "getJson")
      .mockResolvedValue({ statusCode: 200, body: RDAP_RESPONSE } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    __resetWhoisMock();
  });

  describe("Auto on a TLD whose WHOIS server is retired (issue #3046)", () => {
    beforeEach(() => {
      // WHOIS for .digital answers with no registration data at all.
      __setWhoisResponse(TLD_NOT_SUPPORTED_WHOIS);
    });

    it("reads the record over RDAP instead of reporting an empty success", async () => {
      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          isOnlineCheckRequest: true,
        });

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(true);
      expect(response!.lookupMethod).toBe(DomainLookupMethod.RDAP);
      expect(response!.expiresDate).toBe("2026-09-10T16:00:01.587Z");
      expect(response!.registrar).toBe("Name.com, Inc.");
      expect(response!.nameServers).toEqual(["ns-525.awsdns-01.net"]);
      expect(response!.domainStatus).toEqual(["clientTransferProhibited"]);
      expect(response!.failureCause).toBe("");
      /*
       * Explicitly false, not undefined: criteria compare booleans, so an
       * unset value makes "Is Request Timeout / False" undecidable and, under
       * FilterCondition.All, stops the monitor ever going back online.
       */
      expect(response!.isTimeout).toBe(false);
    });

    it("never has to ask WHOIS", async () => {
      await DomainMonitorUtil.query(buildConfig(), {
        isOnlineCheckRequest: true,
      });

      expect(__getWhoisCalls()).toHaveLength(0);
    });
  });

  describe("Auto on a TLD with no RDAP service", () => {
    beforeEach(() => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [],
      } as never);
      __setWhoisResponse(WORKING_WHOIS);
    });

    it("falls back to WHOIS and succeeds", async () => {
      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(
          buildConfig({ domainName: "example.io" }),
          { isOnlineCheckRequest: true },
        );

      expect(response!.isOnline).toBe(true);
      expect(response!.lookupMethod).toBe(DomainLookupMethod.WHOIS);
      expect(response!.expiresDate).toBe("2030-01-02T03:04:05.000Z");
      expect(response!.registrar).toBe("Example Registrar Ltd");
      expect(response!.isTimeout).toBe(false);
    });

    it("does not issue an RDAP request", async () => {
      await DomainMonitorUtil.query(buildConfig({ domainName: "example.io" }), {
        isOnlineCheckRequest: true,
      });

      expect(getJsonSpy).not.toHaveBeenCalled();
    });
  });

  describe("Auto when the RDAP server is unreachable", () => {
    it("falls back to WHOIS within the same attempt", async () => {
      getJsonSpy.mockRejectedValue(new Error("connect ECONNREFUSED") as never);
      __setWhoisResponse(WORKING_WHOIS);

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          isOnlineCheckRequest: true,
        });

      expect(response!.isOnline).toBe(true);
      expect(response!.lookupMethod).toBe(DomainLookupMethod.WHOIS);
      expect(response!.totalAttempts).toBe(1);
    });
  });

  describe("Auto when the registry says the domain is not registered", () => {
    beforeEach(() => {
      getJsonSpy.mockResolvedValue({ statusCode: 404, body: null } as never);
      __setWhoisResponse(WORKING_WHOIS);
    });

    it("reports the failure rather than second-guessing the registry", async () => {
      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          isOnlineCheckRequest: true,
        });

      expect(response!.isOnline).toBe(false);
      expect(response!.failureCause).toContain("not registered");
    });

    it("does not fall back to WHOIS", async () => {
      await DomainMonitorUtil.query(buildConfig(), {
        isOnlineCheckRequest: true,
      });

      expect(__getWhoisCalls()).toHaveLength(0);
    });

    it("does not retry", async () => {
      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig({ retries: 3 }), {
          isOnlineCheckRequest: true,
        });

      expect(response!.totalAttempts).toBe(1);
      expect(getJsonSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Auto when both protocols fail", () => {
    beforeEach(() => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [],
      } as never);
      __setWhoisResponse(TLD_NOT_SUPPORTED_WHOIS);
    });

    it("reports offline", async () => {
      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          isOnlineCheckRequest: true,
        });

      expect(response!.isOnline).toBe(false);
      expect(response!.isTimeout).toBe(false);
    });

    it("explains both failures so the operator can tell them apart", async () => {
      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          isOnlineCheckRequest: true,
        });

      expect(response!.failureCause).toContain("RDAP:");
      expect(response!.failureCause).toContain("WHOIS:");
      expect(response!.failureCause).toContain("No RDAP service is published");
      expect(response!.failureCause).toContain("without any registration data");
    });

    /*
     * A content-less WHOIS reply is indistinguishable from a rate-limited or
     * briefly broken registrar, so it stays retryable even though the RDAP
     * half is settled. A dead TLD simply exhausts its attempts.
     */
    it("still retries while one of the two failures could be transient", async () => {
      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig({ retries: 3 }), {
          isOnlineCheckRequest: true,
        });

      expect(response!.totalAttempts).toBe(3);
      expect(response!.isOnline).toBe(false);
    });

    it("does not retry when both answers are genuinely settled", async () => {
      __setWhoisResponse({ domain: "gone.digital", status: "free" });

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig({ retries: 3 }), {
          isOnlineCheckRequest: true,
        });

      expect(response!.totalAttempts).toBe(1);
      expect(__getWhoisCalls()).toHaveLength(1);
    });
  });

  describe("the WHOIS lookup method", () => {
    it("reports a failure when the WHOIS server returns no record", async () => {
      __setWhoisResponse(TLD_NOT_SUPPORTED_WHOIS);

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(
          buildConfig({ lookupMethod: DomainLookupMethod.WHOIS }),
          { isOnlineCheckRequest: true },
        );

      expect(response!.isOnline).toBe(false);
      expect(response!.failureCause).toContain("without any registration data");
      expect(response!.expiresDate).toBeUndefined();
    });

    it("never reaches for RDAP", async () => {
      __setWhoisResponse(WORKING_WHOIS);

      await DomainMonitorUtil.query(
        buildConfig({ lookupMethod: DomainLookupMethod.WHOIS }),
        { isOnlineCheckRequest: true },
      );

      expect(bootstrapSpy).not.toHaveBeenCalled();
      expect(getJsonSpy).not.toHaveBeenCalled();
    });
  });

  describe("the RDAP lookup method", () => {
    it("fails with an actionable message when the TLD has no RDAP service", async () => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [],
      } as never);
      __setWhoisResponse(WORKING_WHOIS);

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(
          buildConfig({
            domainName: "example.io",
            lookupMethod: DomainLookupMethod.RDAP,
          }),
          { isOnlineCheckRequest: true },
        );

      expect(response!.isOnline).toBe(false);
      expect(response!.failureCause).toContain("No RDAP service is published");
      expect(__getWhoisCalls()).toHaveLength(0);
    });
  });

  describe("retries", () => {
    it("retries a transient failure up to the configured limit", async () => {
      getJsonSpy.mockRejectedValue(new Error("socket hang up") as never);
      __setWhoisError(new Error("socket hang up"));

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          retry: 3,
          isOnlineCheckRequest: true,
        });

      expect(response!.totalAttempts).toBe(3);
      expect(response!.probeAttempts).toHaveLength(3);
      expect(response!.probeAttempts![0]!.isOnline).toBe(false);
      expect(response!.probeAttempts![2]!.attemptNumber).toBe(3);
    });

    it("stops as soon as an attempt succeeds", async () => {
      getJsonSpy
        .mockRejectedValueOnce(new Error("socket hang up") as never)
        .mockResolvedValueOnce({
          statusCode: 200,
          body: RDAP_RESPONSE,
        } as never);
      __setWhoisError(new Error("socket hang up"));

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          retry: 3,
          isOnlineCheckRequest: true,
        });

      expect(response!.isOnline).toBe(true);
      expect(response!.totalAttempts).toBe(2);
    });
  });

  describe("timeouts", () => {
    it("classifies a WHOIS socket timeout as a timeout", async () => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [],
      } as never);
      __setWhoisError(new Error("connect ETIMEDOUT 192.0.2.1:43"));

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          retry: 2,
          isOnlineCheckRequest: true,
        });

      expect(response!.isOnline).toBe(false);
      expect(response!.isTimeout).toBe(true);
      expect(response!.failureCause).toBe(
        "Request was tried 2 times and it timed out.",
      );
    });

    /*
     * axios reports its own deadline as ECONNABORTED, which the old
     * substring check did not recognise as a timeout.
     */
    it("classifies an axios ECONNABORTED as a timeout", async () => {
      getJsonSpy.mockRejectedValue(
        new Error("timeout of 5000ms exceeded (ECONNABORTED)") as never,
      );
      __setWhoisError(new Error("ECONNABORTED"));

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          retry: 1,
          isOnlineCheckRequest: true,
        });

      expect(response!.isTimeout).toBe(true);
    });
  });

  describe("the domain name field", () => {
    it("rejects a malformed name without touching the network", async () => {
      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(
          buildConfig({ domainName: "not a domain" }),
          { isOnlineCheckRequest: true },
        );

      expect(response!.isOnline).toBe(false);
      expect(response!.failureCause).toContain("is not a valid domain name");
      expect(bootstrapSpy).not.toHaveBeenCalled();
      expect(__getWhoisCalls()).toHaveLength(0);
    });

    it("accepts a URL pasted into the field", async () => {
      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(
          buildConfig({ domainName: "  HTTPS://Identity.Digital/pricing  " }),
          { isOnlineCheckRequest: true },
        );

      expect(response!.isOnline).toBe(true);
      expect(bootstrapSpy.mock.calls[0]![0]).toBe("identity.digital");
      expect(getJsonSpy.mock.calls[0]![0]).toBe(
        `${RDAP_BASE_URL}domain/identity.digital`,
      );
    });
  });

  describe("configuration handed to the lookups", () => {
    it("uses the step's timeout", async () => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [],
      } as never);
      __setWhoisResponse(WORKING_WHOIS);

      await DomainMonitorUtil.query(buildConfig({ timeout: 7500 }), {
        isOnlineCheckRequest: true,
      });

      const calls: Array<WhoisMockCall> = __getWhoisCalls();
      expect(calls[0]!.options).toEqual({ timeout: 7500, follow: 2 });
    });

    it("lets the caller's timeout win over the step's", async () => {
      await DomainMonitorUtil.query(buildConfig({ timeout: 7500 }), {
        timeout: 2500,
        isOnlineCheckRequest: true,
      });

      expect(getJsonSpy.mock.calls[0]![1]).toEqual({ timeoutInMs: 2500 });
    });

    /*
     * Monitors saved before RDAP support existed carry no lookupMethod at
     * all; they must behave as Auto rather than crash or skip the lookup.
     */
    it("treats a config with no lookupMethod as Auto", async () => {
      const legacyConfig: MonitorStepDomainMonitor = {
        domainName: "identity.digital",
        timeout: 5000,
        retries: 3,
      } as MonitorStepDomainMonitor;

      expect(DomainMonitorUtil.getLookupMethod(legacyConfig)).toBe(
        DomainLookupMethod.Auto,
      );

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(legacyConfig, {
          isOnlineCheckRequest: true,
        });

      expect(response!.isOnline).toBe(true);
      expect(response!.lookupMethod).toBe(DomainLookupMethod.RDAP);
    });

    it("treats an unrecognised lookupMethod as Auto", async () => {
      expect(
        DomainMonitorUtil.getLookupMethod({
          domainName: "example.com",
          lookupMethod: "Telepathy" as DomainLookupMethod,
          timeout: 5000,
          retries: 3,
        }),
      ).toBe(DomainLookupMethod.Auto);
    });
  });

  /*
   * A data.iana.org outage says nothing about any TLD. If it were reported
   * as "this TLD has no RDAP service" - permanent - it would skip the
   * retries AND the probe-connectivity gate, and open an incident on every
   * domain monitor on the probe at once.
   */
  describe("when the IANA bootstrap registry is unreachable", () => {
    beforeEach(() => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: false,
        serviceUrls: [],
      } as never);
    });

    it("falls back to WHOIS under Auto and still succeeds", async () => {
      __setWhoisResponse(WORKING_WHOIS);

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          isOnlineCheckRequest: true,
        });

      expect(response!.isOnline).toBe(true);
      expect(response!.lookupMethod).toBe(DomainLookupMethod.WHOIS);
    });

    it("retries rather than declaring the TLD unsupported", async () => {
      __setWhoisResponse(TLD_NOT_SUPPORTED_WHOIS);

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), {
          retry: 3,
          isOnlineCheckRequest: true,
        });

      expect(response!.totalAttempts).toBe(3);
      expect(response!.failureCause).not.toContain(
        "No RDAP service is published",
      );
    });

    it("is dropped by the connectivity gate instead of firing an incident", async () => {
      jest
        .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
        .mockResolvedValue(false as never);
      __setWhoisResponse(TLD_NOT_SUPPORTED_WHOIS);

      await expect(
        DomainMonitorUtil.query(buildConfig(), { retry: 1 }),
      ).resolves.toBeNull();
    });

    it("does the same under the explicit RDAP method", async () => {
      jest
        .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
        .mockResolvedValue(false as never);

      await expect(
        DomainMonitorUtil.query(
          buildConfig({ lookupMethod: DomainLookupMethod.RDAP }),
          { retry: 1 },
        ),
      ).resolves.toBeNull();
    });
  });

  describe("when WHOIS says the domain is not registered", () => {
    it("reports it plainly and does not retry", async () => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [],
      } as never);
      __setWhoisResponse({ domain: "gone.de", status: "free" });

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(
          buildConfig({ domainName: "gone.de", retries: 3 }),
          { isOnlineCheckRequest: true },
        );

      expect(response!.isOnline).toBe(false);
      expect(response!.failureCause).toContain("not registered");
      expect(response!.totalAttempts).toBe(1);
    });
  });

  describe("the probe-connectivity gate", () => {
    beforeEach(() => {
      jest
        .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
        .mockResolvedValue(false as never);
    });

    it("drops a transient failure when the probe itself is offline", async () => {
      getJsonSpy.mockRejectedValue(new Error("socket hang up") as never);
      __setWhoisError(new Error("socket hang up"));

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig(), { retry: 1 });

      expect(response).toBeNull();
    });

    /*
     * A registry that answered "no such domain" has already proved the
     * network works. Routing that through the connectivity gate would throw
     * away the very failure the monitor exists to report.
     */
    it("still reports a settled failure when the probe reports itself offline", async () => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [],
      } as never);
      __setWhoisResponse({ domain: "gone.de", status: "free" });

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(buildConfig({ domainName: "gone.de" }), {
          retry: 1,
        });

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.failureCause).toContain("not registered");
    });

    it("still reports an unsupported TLD under the explicit RDAP method", async () => {
      bootstrapSpy.mockResolvedValue({
        isRegistryAvailable: true,
        serviceUrls: [],
      } as never);

      const response: DomainMonitorResponse | null =
        await DomainMonitorUtil.query(
          buildConfig({
            domainName: "example.io",
            lookupMethod: DomainLookupMethod.RDAP,
          }),
          { retry: 1 },
        );

      expect(response).not.toBeNull();
      expect(response!.failureCause).toContain("No RDAP service is published");
    });
  });
});
