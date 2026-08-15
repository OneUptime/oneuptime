import DnssecMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/DnssecMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import DnssecMonitorResponse, {
  DnssecKeyRecord,
} from "../../../../../Types/Monitor/DnssecMonitor/DnssecMonitorResponse";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";

function buildDnssecResponse(
  overrides: Partial<DnssecMonitorResponse>,
): DnssecMonitorResponse {
  return {
    isOnline: true,
    responseTimeInMs: 10,
    failureCause: "",
    domainName: "cloudflare.com",
    isZoneSigned: true,
    dnskeys: [],
    parentDsRecords: [],
    isParentDsPresent: false,
    rrsigs: [],
    resolverChecks: [],
    resolverConsensusAd: false,
    nameserverChecks: [],
    isNameserverConsistent: false,
    isChainValid: false,
    ...overrides,
  };
}

function buildDataToProcess(input: {
  dnssecResponse?: DnssecMonitorResponse | undefined;
}): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: true,
    responseTimeInMs: 10,
    dnssecResponse: input.dnssecResponse,
    monitoredAt: new Date(),
  };
}

async function evaluate(
  dnssecResponse: DnssecMonitorResponse | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return DnssecMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildDataToProcess({ dnssecResponse }),
    criteriaFilter,
  });
}

const SAMPLE_DNSKEY: DnssecKeyRecord = {
  flags: 257,
  algorithm: 13,
  keyTag: 2371,
};

describe("DnssecMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  test("no dnssec response → undecidable for any filter", async () => {
    const result: string | null = await evaluate(undefined, {
      checkOn: CheckOn.DnssecChainValid,
      filterType: FilterType.True,
      value: undefined,
    });

    expect(result).toBeNull();
  });

  describe("DnssecChainValid", () => {
    test("valid chain + True → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ isChainValid: true }),
        {
          checkOn: CheckOn.DnssecChainValid,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain("DNSSEC chain is valid");
    });

    test("invalid chain + False → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ isChainValid: false }),
        {
          checkOn: CheckOn.DnssecChainValid,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toContain("DNSSEC chain validation failed");
    });

    test("valid chain + False → not met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ isChainValid: true }),
        {
          checkOn: CheckOn.DnssecChainValid,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("DnssecDnskeyExists", () => {
    test("has DNSKEY + True → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ dnskeys: [SAMPLE_DNSKEY] }),
        {
          checkOn: CheckOn.DnssecDnskeyExists,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain("DNSKEY records present");
    });

    test("no DNSKEY + False → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ dnskeys: [] }),
        {
          checkOn: CheckOn.DnssecDnskeyExists,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toContain("No DNSKEY records found");
    });

    test("no DNSKEY + True → not met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ dnskeys: [] }),
        {
          checkOn: CheckOn.DnssecDnskeyExists,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("DnssecDsExists", () => {
    test("parent DS present + True → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ isParentDsPresent: true }),
        {
          checkOn: CheckOn.DnssecDsExists,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain("DS records present at parent zone");
    });

    test("parent DS absent + False → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ isParentDsPresent: false }),
        {
          checkOn: CheckOn.DnssecDsExists,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toContain("No DS records found at the parent zone");
    });
  });

  describe("DnssecResolverConsensus", () => {
    test("consensus + True → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ resolverConsensusAd: true }),
        {
          checkOn: CheckOn.DnssecResolverConsensus,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain("All resolvers report DNSSEC-valid");
    });

    test("no consensus + False → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ resolverConsensusAd: false }),
        {
          checkOn: CheckOn.DnssecResolverConsensus,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toContain("Resolvers do not agree");
    });
  });

  describe("DnssecNameserverConsistent", () => {
    test("consistent + True → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ isNameserverConsistent: true }),
        {
          checkOn: CheckOn.DnssecNameserverConsistent,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain("Authoritative nameservers are consistent");
    });

    test("inconsistent + False → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ isNameserverConsistent: false }),
        {
          checkOn: CheckOn.DnssecNameserverConsistent,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toContain("Authoritative nameservers are inconsistent");
    });
  });

  describe("DnssecSignatureExpiresInDays", () => {
    test("5 days left + LessThan 14 → met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ daysUntilSignatureExpiry: 5 }),
        {
          checkOn: CheckOn.DnssecSignatureExpiresInDays,
          filterType: FilterType.LessThan,
          value: 14,
        },
      );

      expect(result).toBeTruthy();
    });

    test("30 days left + LessThan 14 → not met", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ daysUntilSignatureExpiry: 30 }),
        {
          checkOn: CheckOn.DnssecSignatureExpiresInDays,
          filterType: FilterType.LessThan,
          value: 14,
        },
      );

      expect(result).toBeNull();
    });

    test("no expiry data → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ daysUntilSignatureExpiry: undefined }),
        {
          checkOn: CheckOn.DnssecSignatureExpiresInDays,
          filterType: FilterType.LessThan,
          value: 14,
        },
      );

      expect(result).toBeNull();
    });

    test("unparseable threshold → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDnssecResponse({ daysUntilSignatureExpiry: 5 }),
        {
          checkOn: CheckOn.DnssecSignatureExpiresInDays,
          filterType: FilterType.LessThan,
          value: "not-a-number",
        },
      );

      expect(result).toBeNull();
    });
  });

  test("an unrelated CheckOn is not claimed by this evaluator", async () => {
    const result: string | null = await evaluate(buildDnssecResponse({}), {
      checkOn: CheckOn.ResponseTime,
      filterType: FilterType.LessThan,
      value: 1000,
    });

    expect(result).toBeNull();
  });
});
