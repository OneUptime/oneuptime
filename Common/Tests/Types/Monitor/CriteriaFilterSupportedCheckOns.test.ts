import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import SSLMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/SSLMonitorCriteria";
import DnssecMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/DnssecMonitorCriteria";
import APIRequestCriteria from "../../../Server/Utils/Monitor/Criteria/APIRequestCriteria";

/*
 * Issue #3225. A criteria whose checkOn the monitor type's evaluator never
 * reads cannot match in either direction, and "nothing matched" is silent at
 * runtime: the monitor stays parked at its default status with no timeline
 * event, no incident and no error - indistinguishable in the dashboard from a
 * monitor that never ran at all.
 *
 * getSupportedCheckOns is the single list the dropdown and the save-time
 * validation both read. These tests hold it to its promise: everything on it
 * has to be a check the type's evaluator actually answers.
 */

type EvaluatorFunction = (input: {
  dataToProcess: ProbeMonitorResponse;
  criteriaFilter: CriteriaFilter;
}) => Promise<string | null>;

function baseProbeResponse(): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: true,
    isTimeout: false,
    responseTimeInMs: 42,
    monitoredAt: new Date(),
  };
}

function sslProbeResponse(): ProbeMonitorResponse {
  return {
    ...baseProbeResponse(),
    sslResponse: {
      isSelfSigned: false,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      commonName: "example.com",
    },
  };
}

function dnssecProbeResponse(): ProbeMonitorResponse {
  return {
    ...baseProbeResponse(),
    dnssecResponse: {
      isOnline: true,
      responseTimeInMs: 10,
      failureCause: "",
      domainName: "cloudflare.com",
      isZoneSigned: true,
      dnskeys: [{ flags: 257, algorithm: 13, keyTag: 2371 }],
      parentDsRecords: [],
      isParentDsPresent: true,
      rrsigs: [
        {
          typeCovered: "DNSKEY",
          algorithm: 13,
          keyTag: 2371,
          signerName: "cloudflare.com",
          inception: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          expiration: new Date(
            Date.now() + 10 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
      daysUntilSignatureExpiry: 10,
      resolverChecks: [],
      resolverConsensusAd: true,
      nameserverChecks: [],
      isNameserverConsistent: true,
      isChainValid: true,
    },
  };
}

function pingProbeResponse(): ProbeMonitorResponse {
  return {
    ...baseProbeResponse(),
    pingResponse: {
      packetsSent: 4,
      packetsReceived: 4,
      packetLossPercent: 0,
      jitterInMs: 3,
    },
  };
}

/*
 * A numeric threshold for the checks that compare against one, so a "no
 * threshold means null" guard does not read as "this check is never answered".
 */
const NUMERIC_THRESHOLDS: Partial<Record<CheckOn, number>> = {
  [CheckOn.ResponseTime]: 1000,
  [CheckOn.PacketLossPercent]: 50,
  [CheckOn.Jitter]: 1000,
  [CheckOn.ExpiresInDays]: 1,
  [CheckOn.ExpiresInHours]: 1,
  [CheckOn.DnssecSignatureExpiresInDays]: 1,
};

/*
 * Every filterType a boolean or numeric check might answer to. A check that
 * returns null for all of them, on a fully populated response, is a check the
 * evaluator does not implement.
 */
const FILTER_TYPES: Array<FilterType> = [
  FilterType.True,
  FilterType.False,
  FilterType.GreaterThan,
  FilterType.LessThan,
  FilterType.GreaterThanOrEqualTo,
  FilterType.LessThanOrEqualTo,
  FilterType.EqualTo,
  FilterType.NotEqualTo,
];

async function isCheckOnAnswered(
  evaluator: EvaluatorFunction,
  dataToProcess: ProbeMonitorResponse,
  checkOn: CheckOn,
): Promise<boolean> {
  for (const filterType of FILTER_TYPES) {
    const result: string | null = await evaluator({
      dataToProcess: dataToProcess,
      criteriaFilter: {
        checkOn: checkOn,
        filterType: filterType,
        value: NUMERIC_THRESHOLDS[checkOn],
      },
    });

    if (result) {
      return true;
    }
  }

  return false;
}

describe("CriteriaFilterUtil.getSupportedCheckOns", () => {
  test("returns undefined for a monitor type that has not been audited", () => {
    expect(
      CriteriaFilterUtil.getSupportedCheckOns(MonitorType.Website),
    ).toBeUndefined();
    expect(
      CriteriaFilterUtil.getSupportedCheckOns(MonitorType.API),
    ).toBeUndefined();
  });

  test("SSL Certificate monitors can pick the reachability checks their evaluator reads", () => {
    const supported: Array<CheckOn> | undefined =
      CriteriaFilterUtil.getSupportedCheckOns(MonitorType.SSLCertificate);

    expect(supported).toContain(CheckOn.IsOnline);
    expect(supported).toContain(CheckOn.IsRequestTimeout);
  });

  test("DNSSEC monitors can pick the reachability checks their evaluator reads", () => {
    const supported: Array<CheckOn> | undefined =
      CriteriaFilterUtil.getSupportedCheckOns(MonitorType.DNSSEC);

    expect(supported).toContain(CheckOn.IsOnline);
    expect(supported).toContain(CheckOn.IsRequestTimeout);
  });

  test("the SSL Certificate list still carries every certificate check", () => {
    expect(
      CriteriaFilterUtil.getSupportedCheckOns(MonitorType.SSLCertificate),
    ).toEqual(
      expect.arrayContaining([
        CheckOn.IsValidCertificate,
        CheckOn.IsSelfSignedCertificate,
        CheckOn.IsExpiredCertificate,
        CheckOn.IsNotAValidCertificate,
        CheckOn.ExpiresInDays,
        CheckOn.ExpiresInHours,
      ]),
    );
  });

  test("the DNSSEC list still carries every DNSSEC check", () => {
    expect(CriteriaFilterUtil.getSupportedCheckOns(MonitorType.DNSSEC)).toEqual(
      expect.arrayContaining([
        CheckOn.DnssecChainValid,
        CheckOn.DnssecDnskeyExists,
        CheckOn.DnssecDsExists,
        CheckOn.DnssecResolverConsensus,
        CheckOn.DnssecNameserverConsistent,
        CheckOn.DnssecSignatureExpiresInDays,
      ]),
    );
  });

  test("Ping and IP share one list", () => {
    expect(CriteriaFilterUtil.getSupportedCheckOns(MonitorType.Ping)).toEqual(
      CriteriaFilterUtil.getSupportedCheckOns(MonitorType.IP),
    );
  });

  test("no list repeats a check", () => {
    for (const monitorType of Object.values(MonitorType)) {
      const supported: Array<CheckOn> | undefined =
        CriteriaFilterUtil.getSupportedCheckOns(monitorType);

      if (!supported) {
        continue;
      }

      expect(new Set(supported).size).toBe(supported.length);
    }
  });

  /*
   * The first entry is what the dashboard seeds a new filter with, so it has to
   * be the check a user of that monitor type would actually want.
   */
  test("the first entry is the type's own check, not a generic reachability one", () => {
    expect(
      CriteriaFilterUtil.getSupportedCheckOns(MonitorType.SSLCertificate)?.[0],
    ).toBe(CheckOn.IsValidCertificate);
    expect(
      CriteriaFilterUtil.getSupportedCheckOns(MonitorType.DNSSEC)?.[0],
    ).toBe(CheckOn.DnssecChainValid);
  });
});

describe("every supported CheckOn is actually evaluated server side", () => {
  const cases: Array<{
    monitorType: MonitorType;
    evaluator: EvaluatorFunction;
    buildResponse: () => ProbeMonitorResponse;
  }> = [
    {
      monitorType: MonitorType.SSLCertificate,
      evaluator:
        SSLMonitorCriteria.isMonitorInstanceCriteriaFilterMet.bind(
          SSLMonitorCriteria,
        ),
      buildResponse: sslProbeResponse,
    },
    {
      monitorType: MonitorType.DNSSEC,
      evaluator: DnssecMonitorCriteria.isMonitorInstanceCriteriaFilterMet.bind(
        DnssecMonitorCriteria,
      ),
      buildResponse: dnssecProbeResponse,
    },
    {
      monitorType: MonitorType.Ping,
      evaluator:
        APIRequestCriteria.isMonitorInstanceCriteriaFilterMet.bind(
          APIRequestCriteria,
        ),
      buildResponse: pingProbeResponse,
    },
  ];

  for (const testCase of cases) {
    describe(testCase.monitorType, () => {
      const supported: Array<CheckOn> =
        CriteriaFilterUtil.getSupportedCheckOns(testCase.monitorType) || [];

      test("the type has a supported list", () => {
        expect(supported.length).toBeGreaterThan(0);
      });

      test.each(supported)(
        "%s is answered in at least one direction",
        async (checkOn: CheckOn) => {
          const answered: boolean = await isCheckOnAnswered(
            testCase.evaluator,
            testCase.buildResponse(),
            checkOn,
          );

          expect(answered).toBe(true);
        },
      );
    });
  }
});
