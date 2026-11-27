import { describe, expect, test } from "@jest/globals";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import {
  checkAppliesToKind,
  CheckRemediation,
  DataSecurityCheckInfo,
  DataSecurityCheckStatus,
  DataStoreCheckInput,
  EvaluatedCheck,
  evaluateDataStoreChecks,
  getCheckRemediation,
  getDataSecurityCheck,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../Types/DataSecurity/DataStoreEnvironment";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import {
  DataStorePostureFacts,
  DataStorePostureReadFrom,
} from "../../../Types/DataSecurity/DataStorePosture";
import SecuritySeverity from "../../../Types/SecuritySeverity";

/*
 * ANYONE WHO REACHES IT CAN READ IT WITHOUT CREDENTIALS (#11140).
 *
 * A search cluster you run is asked, without credentials, from where its
 * scan runs: from a probe inside your network, whether the internet
 * reaches it cannot be told, so "Anyone on the internet can read it" is
 * never claimed from there - but that whoever reaches it reads it, or
 * changes it, is seen, and it is this check. Held: what each answer makes
 * of it, how severe it is, that a public search index meant to be read
 * passes while one anyone can wipe does not, and how to fix it on each
 * engine.
 */

const ID: string = "readable-without-credentials";

function input(
  posture: DataStorePostureFacts,
  overrides: Partial<DataStoreCheckInput> = {},
): DataStoreCheckInput {
  return {
    kind: DataStoreKind.Elasticsearch,
    name: "logs-cluster",
    environment: DataStoreEnvironment.Production,
    sensitivity: DataSensitivity.Restricted,
    dataTypeIds: ["us-ssn"],
    dataCategories: [DataCategory.Personal],
    posture: {
      readAt: "2026-11-27T10:00:00Z",
      readFrom: DataStorePostureReadFrom.Network,
      ...posture,
    },
    isPublicByDesign: false,
    hasOwner: true,
    ...overrides,
  };
}

function run(
  posture: DataStorePostureFacts,
  overrides: Partial<DataStoreCheckInput> = {},
): EvaluatedCheck | undefined {
  return evaluateDataStoreChecks(input(posture, overrides)).find(
    (check: EvaluatedCheck): boolean => {
      return check.check.id === ID;
    },
  );
}

describe("readable-without-credentials", () => {
  const check: DataSecurityCheckInfo = getDataSecurityCheck(ID)!;

  test("is an exposure check of every search store", () => {
    expect(check.group).toBe("Exposure");
    expect(checkAppliesToKind(check, DataStoreKind.Elasticsearch)).toBe(true);
    expect(checkAppliesToKind(check, DataStoreKind.OpenSearch)).toBe(true);
    expect(checkAppliesToKind(check, DataStoreKind.AwsOpenSearchDomain)).toBe(
      true,
    );
    expect(checkAppliesToKind(check, DataStoreKind.PostgreSql)).toBe(false);
    expect(checkAppliesToKind(check, DataStoreKind.AwsS3Bucket)).toBe(false);
  });

  test("does not apply where nothing asked without credentials: a cloud's domain, read from its API", () => {
    expect(
      run({ readFrom: undefined }, { kind: DataStoreKind.AwsOpenSearchDomain })
        ?.result.status,
    ).toBe(DataSecurityCheckStatus.NotApplicable);
  });

  test("passes when it asks for credentials, and cannot tell when it could not be asked", () => {
    expect(run({ anonymousRead: false, anonymousWrite: false })?.result.status).toBe(
      DataSecurityCheckStatus.Pass,
    );
    expect(run({ anonymousRead: null, anonymousWrite: null })?.result.status).toBe(
      DataSecurityCheckStatus.Unknown,
    );
  });

  test("fails, as severe as what it holds, when a search is answered without credentials", () => {
    const severities: Array<[DataSensitivity, SecuritySeverity]> = [
      [DataSensitivity.Restricted, SecuritySeverity.Critical],
      [DataSensitivity.Confidential, SecuritySeverity.High],
      [DataSensitivity.Internal, SecuritySeverity.Medium],
      [DataSensitivity.Public, SecuritySeverity.Low],
    ];

    for (const [sensitivity, severity] of severities) {
      const failed: EvaluatedCheck | undefined = run(
        { anonymousRead: true, anonymousWrite: null },
        { sensitivity },
      );

      expect(failed?.result.status).toBe(DataSecurityCheckStatus.Fail);
      expect(failed?.result.evidence).toBe(
        "It answered a search without credentials: anyone who reaches it can read its documents.",
      );
      expect(failed?.severity).toBe(severity);
    }
  });

  test("with no access control at all, it can be wiped: Critical for sensitive data, High for any other", () => {
    const severities: Array<[DataSensitivity, SecuritySeverity]> = [
      [DataSensitivity.Restricted, SecuritySeverity.Critical],
      [DataSensitivity.Confidential, SecuritySeverity.Critical],
      [DataSensitivity.Internal, SecuritySeverity.High],
      [DataSensitivity.Public, SecuritySeverity.High],
    ];

    for (const [sensitivity, severity] of severities) {
      const failed: EvaluatedCheck | undefined = run(
        { anonymousRead: true, anonymousWrite: true },
        { sensitivity },
      );

      expect(failed?.result.evidence).toBe(
        "It answered without credentials and has no access control of its own: anyone who reaches it can read, change and delete its data.",
      );
      expect(failed?.severity).toBe(severity);
    }
  });

  test("a search index public by design passes being read, never being wiped", () => {
    expect(
      run(
        { anonymousRead: true, anonymousWrite: null },
        { isPublicByDesign: true },
      )?.result.status,
    ).toBe(DataSecurityCheckStatus.Pass);
    expect(
      run(
        { anonymousRead: true, anonymousWrite: true },
        { isPublicByDesign: true },
      )?.result.status,
    ).toBe(DataSecurityCheckStatus.Fail);
  });

  test("a severity override for the check is the issue's", () => {
    const failed: EvaluatedCheck | undefined = evaluateDataStoreChecks(
      input({ anonymousRead: true, anonymousWrite: null }),
      { severityOverrides: new Map([[ID, SecuritySeverity.Low]]) },
    ).find((evaluated: EvaluatedCheck): boolean => {
      return evaluated.check.id === ID;
    });

    expect(failed?.severity).toBe(SecuritySeverity.Low);
  });

  test("says how to fix it on Elasticsearch, on OpenSearch, and on anything else", () => {
    const elasticsearch: CheckRemediation | undefined = getCheckRemediation(
      check,
      DataStoreKind.Elasticsearch,
    );
    const opensearch: CheckRemediation | undefined = getCheckRemediation(
      check,
      DataStoreKind.OpenSearch,
    );

    expect(elasticsearch?.steps.join(" ")).toContain(
      "xpack.security.enabled: true",
    );
    expect(elasticsearch?.steps.join(" ")).toContain(
      "xpack.security.authc.anonymous.roles",
    );
    expect(opensearch?.steps.join(" ")).toContain(
      "plugins.security.disabled: true",
    );
    expect(opensearch?.steps.join(" ")).toContain("anonymous_auth_enabled");
    expect(
      getCheckRemediation(check, DataStoreKind.AwsOpenSearchDomain)?.steps,
    ).toEqual([
      "Require credentials for every request, and give each application its own read-only user.",
    ]);
  });
});

describe("the checks a store asked at its own address cannot pass by what it never read", () => {
  test("who holds access to it was never read: the reader checks cannot tell, rather than pass", () => {
    const evaluated: Array<EvaluatedCheck> = evaluateDataStoreChecks(
      input(
        { anonymousRead: false, anonymousWrite: false },
        { readerCount: null, unusedReaderNames: null },
      ),
    );

    for (const id of ["many-readers", "unused-access"]) {
      expect(
        evaluated.find((check: EvaluatedCheck): boolean => {
          return check.check.id === id;
        })?.result.status,
      ).toBe(DataSecurityCheckStatus.Unknown);
    }
  });

  test("whether the internet reaches it, unknowable from inside the network, is no failure", () => {
    const evaluated: Array<EvaluatedCheck> = evaluateDataStoreChecks(
      input({
        anonymousRead: false,
        anonymousWrite: false,
        publicRead: false,
        publicWrite: false,
        publicNetworkAccess: null,
        openToAllAddresses: null,
        unknowableFacts: ["publicNetworkAccess", "openToAllAddresses"],
      }),
    );
    const statusOf: (id: string) => string | undefined = (
      id: string,
    ): string | undefined => {
      return evaluated.find((check: EvaluatedCheck): boolean => {
        return check.check.id === id;
      })?.result.status;
    };

    expect(statusOf("internet-reachable")).toBe(DataSecurityCheckStatus.Unknown);
    expect(statusOf("open-to-all-addresses")).toBe(
      DataSecurityCheckStatus.Unknown,
    );
    expect(statusOf("public-read")).toBe(DataSecurityCheckStatus.Pass);
    expect(statusOf("public-write")).toBe(DataSecurityCheckStatus.Pass);
  });

  test("secrets in a store whose exposure cannot be told are not raised to Critical", () => {
    const secrets: EvaluatedCheck | undefined = evaluateDataStoreChecks(
      input(
        { anonymousRead: false, publicNetworkAccess: null },
        { dataTypeIds: ["aws-secret-access-key"], sensitivity: DataSensitivity.Restricted },
      ),
    ).find((check: EvaluatedCheck): boolean => {
      return check.check.id === "secrets-stored";
    });

    expect(secrets?.result.status).toBe(DataSecurityCheckStatus.Fail);
    expect(secrets?.result.severity).toBeUndefined();
  });
});
