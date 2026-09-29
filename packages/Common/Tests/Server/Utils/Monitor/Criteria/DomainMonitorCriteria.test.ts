import DomainMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/DomainMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import DomainLookupMethod from "../../../../../Types/Monitor/DomainMonitor/DomainLookupMethod";
import DomainMonitorResponse from "../../../../../Types/Monitor/DomainMonitor/DomainMonitorResponse";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildDataToProcess(input: {
  isOnline?: boolean;
  isTimeout?: boolean;
  failureCause?: string;
  expiresDate?: string | undefined;
  registrar?: string | undefined;
  nameServers?: Array<string> | undefined;
  domainStatus?: Array<string> | undefined;
  lookupMethod?: DomainLookupMethod | undefined;
}): ProbeMonitorResponse {
  const domainResponse: DomainMonitorResponse = {
    isOnline: input.isOnline ?? true,
    responseTimeInMs: 42,
    failureCause: input.failureCause ?? "",
    domainName: "identity.digital",
    expiresDate: input.expiresDate,
    registrar: input.registrar,
    nameServers: input.nameServers,
    domainStatus: input.domainStatus,
    lookupMethod: input.lookupMethod,
  };

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: input.failureCause ?? "",
    isOnline: input.isOnline ?? true,
    isTimeout: input.isTimeout,
    responseTimeInMs: 42,
    domainResponse: domainResponse,
    monitoredAt: new Date(),
  };
}

async function evaluate(
  dataToProcess: ProbeMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return DomainMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess,
    criteriaFilter,
  });
}

describe("DomainMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  /*
   * Regression for issue #3046. A domain whose TLD has no working WHOIS or
   * RDAP service comes back with no expiry date, which makes every Domain*
   * filter undecidable - so without an IsOnline check the monitor keeps its
   * previous status and the failure is invisible.
   */
  describe("IsOnline", () => {
    test("a failed lookup + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: false,
          expiresDate: undefined,
          failureCause:
            "The WHOIS server for identity.digital answered without any registration data.",
        }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("a failed lookup + True → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: false, expiresDate: undefined }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("a successful lookup + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true, expiresDate: daysFromNow(90) }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("a successful lookup + False → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("IsRequestTimeout", () => {
    test("timed out + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: false, isTimeout: true }),
        {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("did not time out + True → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true, isTimeout: false }),
        {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * The probe has to send isTimeout: false explicitly on success. If it
     * left the field unset this filter would be undecidable on every healthy
     * check, and under FilterCondition.All the monitor could never go back
     * online.
     */
    test("did not time out + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true, isTimeout: false }),
        {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("an unset isTimeout is undecidable in both directions", async () => {
      await expect(
        evaluate(buildDataToProcess({ isOnline: true }), {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.False,
          value: undefined,
        }),
      ).resolves.toBeNull();

      await expect(
        evaluate(buildDataToProcess({ isOnline: true }), {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.True,
          value: undefined,
        }),
      ).resolves.toBeNull();
    });
  });

  describe("DomainExpiresDaysIn", () => {
    test("expiring in 10 days + LessThan 30 → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ expiresDate: daysFromNow(10) }),
        {
          checkOn: CheckOn.DomainExpiresDaysIn,
          filterType: FilterType.LessThan,
          value: 30,
        },
      );

      expect(result).toBeTruthy();
    });

    test("expiring in 90 days + LessThan 30 → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ expiresDate: daysFromNow(90) }),
        {
          checkOn: CheckOn.DomainExpiresDaysIn,
          filterType: FilterType.LessThan,
          value: 30,
        },
      );

      expect(result).toBeNull();
    });

    // An unreadable registration cannot answer this - hence the IsOnline check.
    test("no expiry date → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: false, expiresDate: undefined }),
        {
          checkOn: CheckOn.DomainExpiresDaysIn,
          filterType: FilterType.LessThan,
          value: 30,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("DomainIsExpired", () => {
    test("already expired + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ expiresDate: daysFromNow(-1) }),
        {
          checkOn: CheckOn.DomainIsExpired,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Domain is expired");
    });

    test("not expired + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ expiresDate: daysFromNow(30) }),
        {
          checkOn: CheckOn.DomainIsExpired,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Domain is not expired");
    });

    test("no expiry date → undecidable in both directions", async () => {
      await expect(
        evaluate(buildDataToProcess({ expiresDate: undefined }), {
          checkOn: CheckOn.DomainIsExpired,
          filterType: FilterType.True,
          value: undefined,
        }),
      ).resolves.toBeNull();

      await expect(
        evaluate(buildDataToProcess({ expiresDate: undefined }), {
          checkOn: CheckOn.DomainIsExpired,
          filterType: FilterType.False,
          value: undefined,
        }),
      ).resolves.toBeNull();
    });
  });

  describe("DomainRegistrar", () => {
    test("matches on equality", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ registrar: "Name.com, Inc." }),
        {
          checkOn: CheckOn.DomainRegistrar,
          filterType: FilterType.EqualTo,
          value: "Name.com, Inc.",
        },
      );

      expect(result).toBeTruthy();
    });

    test("no registrar → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ registrar: undefined }),
        {
          checkOn: CheckOn.DomainRegistrar,
          filterType: FilterType.EqualTo,
          value: "Name.com, Inc.",
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("DomainNameServer", () => {
    test("matches any one of the name servers", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          nameServers: ["ns-525.awsdns-01.net", "ns-341.awsdns-42.com"],
        }),
        {
          checkOn: CheckOn.DomainNameServer,
          filterType: FilterType.Contains,
          value: "awsdns-42",
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Domain name server: ");
    });

    test("no match → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ nameServers: ["ns1.example.com"] }),
        {
          checkOn: CheckOn.DomainNameServer,
          filterType: FilterType.Contains,
          value: "cloudflare",
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("DomainStatusCode", () => {
    /*
     * RDAP publishes "client transfer prohibited" and WHOIS publishes
     * "clientTransferProhibited". The probe folds both to the EPP name so a
     * criterion keeps matching when Auto switches protocol.
     */
    test("matches the EPP status name both lookup methods normalize to", async () => {
      const viaRdap: string | null = await evaluate(
        buildDataToProcess({
          domainStatus: ["clientTransferProhibited"],
          lookupMethod: DomainLookupMethod.RDAP,
        }),
        {
          checkOn: CheckOn.DomainStatusCode,
          filterType: FilterType.Contains,
          value: "clientTransferProhibited",
        },
      );

      const viaWhois: string | null = await evaluate(
        buildDataToProcess({
          domainStatus: ["clientTransferProhibited"],
          lookupMethod: DomainLookupMethod.WHOIS,
        }),
        {
          checkOn: CheckOn.DomainStatusCode,
          filterType: FilterType.Contains,
          value: "clientTransferProhibited",
        },
      );

      expect(viaRdap).toBeTruthy();
      expect(viaRdap).toContain("Domain status: ");
      expect(viaWhois).toBeTruthy();
    });

    test("no statuses → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ domainStatus: [] }),
        {
          checkOn: CheckOn.DomainStatusCode,
          filterType: FilterType.Contains,
          value: "clientHold",
        },
      );

      expect(result).toBeNull();
    });
  });

  test("an unrelated CheckOn is not claimed by this evaluator", async () => {
    const result: string | null = await evaluate(buildDataToProcess({}), {
      checkOn: CheckOn.ResponseTime,
      filterType: FilterType.LessThan,
      value: 1000,
    });

    expect(result).toBeNull();
  });
});
