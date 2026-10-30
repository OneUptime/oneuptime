import { describe, expect, test } from "@jest/globals";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import { ALL_COMPLIANCE_FRAMEWORKS } from "../../../Types/DataSecurity/ComplianceFramework";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import {
  ALL_DATA_SECURITY_CHECK_GROUPS,
  checkAppliesToKind,
  CheckRemediation,
  DATA_SECURITY_CHECKS,
  DataSecurityCheckInfo,
  DataSecurityCheckStatus,
  DataStoreCheckInput,
  EvaluatedCheck,
  evaluateDataStoreChecks,
  fillRemediationText,
  getCheckRemediation,
  getDataSecurityCheck,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import { RISK_BASE_BY_SEVERITY } from "../../../Types/DataSecurity/DataSecurityRisk";
import DataSensitivity, {
  ALL_DATA_SENSITIVITIES,
} from "../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../Types/DataSecurity/DataStoreEnvironment";
import {
  DATA_STORE_KINDS,
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import { DATA_TYPE_CATALOG } from "../../../Types/DataSecurity/DataTypeCatalog";

/*
 * EVERY CHECK, RUN ON STORES BUILT BY HAND.
 *
 * A check reads facts and passes, fails or cannot tell; a failing one is
 * as severe as the store is sensitive, unless its evidence says more. The
 * fixtures here are the stores that matter: a public bucket of card
 * numbers, the same bucket made public on purpose, a store whose facts
 * could not be read, secrets where outsiders can reach them, a development
 * copy of production data, data nobody has touched in months.
 */

const NOW: Date = new Date(Date.UTC(2026, 9, 27, 12, 0, 0));
const KEBAB_CASE: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY_IN_MS: number = 86_400_000;

function store(
  overrides: Partial<DataStoreCheckInput> = {},
): DataStoreCheckInput {
  return {
    kind: DataStoreKind.AwsS3Bucket,
    name: "acme-exports",
    region: "us-east-1",
    environment: DataStoreEnvironment.Production,
    sensitivity: DataSensitivity.Restricted,
    dataTypeIds: ["credit-card-number"],
    dataCategories: [DataCategory.Financial],
    posture: {
      readAt: "2026-10-27T11:00:00Z",
      publicRead: false,
      publicWrite: false,
      blockPublicAccess: true,
      encryptedAtRest: true,
      customerManagedKey: true,
      encryptionInTransitEnforced: true,
      versioning: true,
      accessLogging: true,
      uniformAccess: true,
      sharedWithExternal: [],
    },
    isPublicByDesign: false,
    hasOwner: true,
    lastActivityAt: new Date(NOW.getTime() - DAY_IN_MS),
    readerCount: 4,
    now: NOW,
    ...overrides,
  };
}

function evaluated(
  input: DataStoreCheckInput,
  checkId: string,
  options: Parameters<typeof evaluateDataStoreChecks>[1] = {},
): EvaluatedCheck | undefined {
  return evaluateDataStoreChecks(input, options).find(
    (each: EvaluatedCheck) => {
      return each.check.id === checkId;
    },
  );
}

function outcome(
  input: DataStoreCheckInput,
  checkId: string,
): [DataSecurityCheckStatus | undefined, SecuritySeverity | null | undefined] {
  const result: EvaluatedCheck | undefined = evaluated(input, checkId);

  return [result?.result.status, result?.severity];
}

const SEVERITY_RANK: (severity: SecuritySeverity | null) => number = (
  severity: SecuritySeverity | null,
): number => {
  return severity ? RISK_BASE_BY_SEVERITY[severity] + 1 : 0;
};

describe("the check catalog", () => {
  test("has unique, kebab-case ids that getDataSecurityCheck finds", () => {
    const ids: Array<string> = DATA_SECURITY_CHECKS.map(
      (check: DataSecurityCheckInfo) => {
        return check.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);

    for (const id of ids) {
      expect([id, KEBAB_CASE.test(id)]).toEqual([id, true]);
      expect(getDataSecurityCheck(id)?.id).toBe(id);
    }

    expect(getDataSecurityCheck("no-such-check")).toBeUndefined();
  });

  test.each(
    DATA_SECURITY_CHECKS.map(
      (check: DataSecurityCheckInfo): [string, DataSecurityCheckInfo] => {
        return [check.id, check];
      },
    ),
  )(
    "%s says what it is, why it matters and what it is evidence for",
    (_id: string, check: DataSecurityCheckInfo) => {
      expect(check.title.trim().length).toBeGreaterThan(0);
      expect(check.description.trim().length).toBeGreaterThan(0);
      expect(check.whyItMatters.trim().length).toBeGreaterThan(0);
      expect(ALL_DATA_SECURITY_CHECK_GROUPS).toContain(check.group);
      expect(check.requirements.length).toBeGreaterThan(0);

      for (const requirement of check.requirements) {
        expect(ALL_COMPLIANCE_FRAMEWORKS).toContain(requirement.framework);
        expect(requirement.requirement.trim().length).toBeGreaterThan(0);
      }
    },
  );

  test.each(
    DATA_SECURITY_CHECKS.map(
      (check: DataSecurityCheckInfo): [string, DataSecurityCheckInfo] => {
        return [check.id, check];
      },
    ),
  )(
    "%s has a severity for every sensitivity, never less for more sensitive data",
    (_id: string, check: DataSecurityCheckInfo) => {
      const levels: Array<SecuritySeverity | null> = ALL_DATA_SENSITIVITIES.map(
        (sensitivity: DataSensitivity) => {
          return check.severityBySensitivity[sensitivity];
        },
      );

      for (const level of levels) {
        expect(
          level === null || Object.values(SecuritySeverity).includes(level),
        ).toBe(true);
      }

      // Most sensitive first: each level at least as severe as the next.
      for (let index: number = 1; index < levels.length; index++) {
        expect(SEVERITY_RANK(levels[index - 1]!)).toBeGreaterThanOrEqual(
          SEVERITY_RANK(levels[index]!),
        );
      }

      expect(levels[0]).not.toBeNull();
    },
  );

  test.each(
    DATA_SECURITY_CHECKS.map(
      (check: DataSecurityCheckInfo): [string, DataSecurityCheckInfo] => {
        return [check.id, check];
      },
    ),
  )(
    "%s says how to fix it on every kind of store it applies to",
    (_id: string, check: DataSecurityCheckInfo) => {
      const keys: Array<string> = [
        ...Object.values(DataStoreKind),
        ...Object.values(DataStoreProvider),
        "default",
      ];

      for (const key of Object.keys(check.remediation)) {
        expect(keys).toContain(key);
      }

      for (const info of DATA_STORE_KINDS) {
        if (!checkAppliesToKind(check, info.kind)) {
          continue;
        }

        const remediation: CheckRemediation | undefined = getCheckRemediation(
          check,
          info.kind,
        );

        expect([info.kind, (remediation?.steps.length || 0) > 0]).toEqual([
          info.kind,
          true,
        ]);
      }
    },
  );
});

describe("public-read", () => {
  test("is Critical on a public bucket of card numbers", () => {
    const input: DataStoreCheckInput = store({
      posture: {
        ...store().posture,
        publicRead: true,
        blockPublicAccess: false,
        publicReason: 'The bucket policy grants s3:GetObject to Principal "*".',
      },
    });
    const result: EvaluatedCheck | undefined = evaluated(input, "public-read");

    expect(result?.result).toEqual({
      status: DataSecurityCheckStatus.Fail,
      evidence: 'The bucket policy grants s3:GetObject to Principal "*".',
      severity: undefined,
    });
    expect(result?.severity).toBe(SecuritySeverity.Critical);
    expect(outcome(input, "public-access-not-blocked")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.High,
    ]);
  });

  test("passes when the bucket is public by design", () => {
    const input: DataStoreCheckInput = store({
      isPublicByDesign: true,
      posture: {
        ...store().posture,
        publicRead: true,
        blockPublicAccess: false,
      },
    });

    expect(outcome(input, "public-read")).toEqual([
      DataSecurityCheckStatus.Pass,
      null,
    ]);
    expect(outcome(input, "public-access-not-blocked")).toEqual([
      DataSecurityCheckStatus.Pass,
      null,
    ]);
  });

  test("is only Low on a public bucket that holds nothing sensitive", () => {
    expect(
      outcome(
        store({
          sensitivity: DataSensitivity.Public,
          dataTypeIds: [],
          dataCategories: [],
          posture: { ...store().posture, publicRead: true },
        }),
        "public-read",
      ),
    ).toEqual([DataSecurityCheckStatus.Fail, SecuritySeverity.Low]);
  });

  test("gives its own evidence when the cloud gave no reason", () => {
    expect(
      evaluated(
        store({ posture: { ...store().posture, publicRead: true } }),
        "public-read",
      )?.result.evidence,
    ).toBe("Its access settings let anyone read it without signing in.");
  });
});

describe("facts the reader could not read", () => {
  test("make a check Unknown, never a failure", () => {
    const input: DataStoreCheckInput = store({
      posture: {
        readAt: "2026-10-27T11:00:00Z",
        publicRead: null,
        publicWrite: null,
        blockPublicAccess: null,
        encryptedAtRest: null,
        customerManagedKey: null,
        encryptionInTransitEnforced: null,
        minimumTlsVersion: null,
        versioning: null,
        softDelete: null,
        accessLogging: null,
        uniformAccess: null,
      },
      readerCount: null,
      lastActivityAt: null,
    });

    for (const checkId of [
      "public-read",
      "public-write",
      "public-access-not-blocked",
      "not-encrypted-at-rest",
      "no-customer-managed-key",
      "encryption-in-transit-not-enforced",
      "weak-tls",
      "deleted-data-not-recoverable",
      "access-not-logged",
      "object-acls-enabled",
      "many-readers",
      "stale-sensitive-data",
    ]) {
      expect([checkId, outcome(input, checkId)]).toEqual([
        checkId,
        [DataSecurityCheckStatus.Unknown, null],
      ]);
    }
  });

  test("that do not exist for the kind make a check Not applicable", () => {
    const input: DataStoreCheckInput = store({
      posture: { readAt: "2026-10-27T11:00:00Z" },
    });

    for (const checkId of [
      "public-read",
      "public-write",
      "not-encrypted-at-rest",
      "weak-tls",
      "deleted-data-not-recoverable",
      "shared-with-external-accounts",
    ]) {
      expect([checkId, outcome(input, checkId)]).toEqual([
        checkId,
        [DataSecurityCheckStatus.NotApplicable, null],
      ]);
    }
  });
});

describe("secrets-stored", () => {
  const withSecrets: Partial<DataStoreCheckInput> = {
    dataTypeIds: ["aws-access-key-id", "email-address"],
    dataCategories: [
      DataCategory.SecretsAndCredentials,
      DataCategory.ContactAndIdentity,
    ],
  };

  test("is High in a private store, and Critical where outsiders can reach it", () => {
    expect(outcome(store(withSecrets), "secrets-stored")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.High,
    ]);
    expect(
      outcome(
        store({
          ...withSecrets,
          posture: { ...store().posture, publicRead: true },
        }),
        "secrets-stored",
      ),
    ).toEqual([DataSecurityCheckStatus.Fail, SecuritySeverity.Critical]);
    expect(
      outcome(
        store({
          ...withSecrets,
          posture: {
            ...store().posture,
            sharedWithExternal: ["arn:aws:iam::999999999999:root"],
          },
        }),
        "secrets-stored",
      ),
    ).toEqual([DataSecurityCheckStatus.Fail, SecuritySeverity.Critical]);
  });

  test("counts the kinds of secret it found", () => {
    expect(
      evaluated(
        store({
          dataTypeIds: ["github-token", "private-key", "email-address"],
        }),
        "secrets-stored",
      )?.result.evidence,
    ).toBe("Found 2 kind(s) of secret.");
  });

  test("fails on exactly the catalog's secrets", () => {
    for (const info of DATA_TYPE_CATALOG) {
      const status: DataSecurityCheckStatus | undefined = outcome(
        store({ dataTypeIds: [info.id] }),
        "secrets-stored",
      )[0];

      expect([info.id, status]).toEqual([
        info.id,
        info.category === DataCategory.SecretsAndCredentials
          ? DataSecurityCheckStatus.Fail
          : DataSecurityCheckStatus.Pass,
      ]);
    }
  });
});

describe("production-data-in-non-production", () => {
  test("fails on a development copy of a production store, by the store's sensitivity", () => {
    const copy: DataStoreCheckInput = store({
      name: "acme-exports-dev",
      environment: DataStoreEnvironment.Development,
      copiedFromProductionStoreName: "acme-exports",
    });

    expect(
      evaluated(copy, "production-data-in-non-production")?.result.evidence,
    ).toBe("It holds copies of data from acme-exports.");
    expect(outcome(copy, "production-data-in-non-production")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.High,
    ]);
    expect(
      outcome(
        { ...copy, sensitivity: DataSensitivity.Confidential },
        "production-data-in-non-production",
      ),
    ).toEqual([DataSecurityCheckStatus.Fail, SecuritySeverity.Medium]);
  });

  test("passes on a non-production store without copies, and does not apply to production", () => {
    expect(
      outcome(
        store({ environment: DataStoreEnvironment.Test }),
        "production-data-in-non-production",
      ),
    ).toEqual([DataSecurityCheckStatus.Pass, null]);
    expect(
      outcome(
        store({ copiedFromProductionStoreName: "acme-exports" }),
        "production-data-in-non-production",
      ),
    ).toEqual([DataSecurityCheckStatus.NotApplicable, null]);
    expect(
      outcome(
        store({
          environment: DataStoreEnvironment.Unknown,
          copiedFromProductionStoreName: "acme-exports",
        }),
        "production-data-in-non-production",
      ),
    ).toEqual([DataSecurityCheckStatus.NotApplicable, null]);
  });
});

describe("stale-sensitive-data", () => {
  test("fails after 90 days without activity, counted from the given now", () => {
    const idle: (days: number) => DataStoreCheckInput = (
      days: number,
    ): DataStoreCheckInput => {
      return store({
        lastActivityAt: new Date(NOW.getTime() - days * DAY_IN_MS),
      });
    };

    expect(outcome(idle(89), "stale-sensitive-data")).toEqual([
      DataSecurityCheckStatus.Pass,
      null,
    ]);
    expect(outcome(idle(90), "stale-sensitive-data")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.Medium,
    ]);
    expect(evaluated(idle(400), "stale-sensitive-data")?.result.evidence).toBe(
      "No activity for 400 days.",
    );
    expect(
      outcome(store({ lastActivityAt: undefined }), "stale-sensitive-data"),
    ).toEqual([DataSecurityCheckStatus.Unknown, null]);
  });
});

describe("residency-violation", () => {
  test("fails when the store's region breaks a rule, and says which", () => {
    const input: DataStoreCheckInput = store({
      residencyViolations: [
        { ruleName: "EU personal data stays in the EU", region: "us-east-1" },
        { ruleName: "EU personal data stays in the EU", region: "ap-south-1" },
      ],
    });

    expect(evaluated(input, "residency-violation")?.result.evidence).toBe(
      'us-east-1 is outside what "EU personal data stays in the EU" allows.',
    );
    expect(outcome(input, "residency-violation")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.High,
    ]);
    expect(outcome(store(), "residency-violation")).toEqual([
      DataSecurityCheckStatus.Pass,
      null,
    ]);
  });
});

describe("the project's settings", () => {
  const publicBucket: DataStoreCheckInput = store({
    posture: { ...store().posture, publicRead: true },
  });

  test("leave a disabled check out", () => {
    const ids: Array<string> = evaluateDataStoreChecks(publicBucket, {
      disabledCheckIds: new Set(["public-read"]),
    }).map((each: EvaluatedCheck) => {
      return each.check.id;
    });

    expect(ids).not.toContain("public-read");
    expect(ids).toContain("public-write");
  });

  test("override a check's severity, over its map and its evidence", () => {
    expect(
      evaluated(publicBucket, "public-read", {
        severityOverrides: new Map([["public-read", SecuritySeverity.Low]]),
      })?.severity,
    ).toBe(SecuritySeverity.Low);
    expect(
      evaluated(
        store({
          dataTypeIds: ["github-token"],
          posture: { ...store().posture, publicRead: true },
        }),
        "secrets-stored",
        {
          severityOverrides: new Map([
            ["secrets-stored", SecuritySeverity.Medium],
          ]),
        },
      )?.severity,
    ).toBe(SecuritySeverity.Medium);
  });

  test("give a passing check no severity, even with an override", () => {
    expect(
      evaluated(store(), "public-read", {
        severityOverrides: new Map([
          ["public-read", SecuritySeverity.Critical],
        ]),
      })?.severity,
    ).toBeNull();
  });
});

describe("the other checks", () => {
  test("weak-tls fails below TLS 1.2 however the version is written", () => {
    const tls: (version: string | null | undefined) => DataStoreCheckInput = (
      version: string | null | undefined,
    ): DataStoreCheckInput => {
      return store({
        posture: { ...store().posture, minimumTlsVersion: version },
      });
    };

    expect(outcome(tls("TLS1_0"), "weak-tls")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.Medium,
    ]);
    expect(evaluated(tls("1.1"), "weak-tls")?.result.evidence).toBe(
      "The minimum TLS version is 1.1.",
    );
    expect(outcome(tls("TLS1_2"), "weak-tls")[0]).toBe(
      DataSecurityCheckStatus.Pass,
    );
    expect(outcome(tls("TLSv1.3"), "weak-tls")[0]).toBe(
      DataSecurityCheckStatus.Pass,
    );
  });

  test("no-backups reads whether backups run and how long they are kept", () => {
    const database: (
      backups: Partial<DataStoreCheckInput["posture"]>,
    ) => DataStoreCheckInput = (
      backups: Partial<DataStoreCheckInput["posture"]>,
    ): DataStoreCheckInput => {
      return store({
        kind: DataStoreKind.AwsRdsInstance,
        posture: { readAt: NOW.toISOString(), ...backups },
      });
    };

    expect(outcome(database({ backupsEnabled: false }), "no-backups")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.High,
    ]);
    expect(
      evaluated(
        database({ backupsEnabled: true, backupRetentionDays: 3 }),
        "no-backups",
      )?.result.evidence,
    ).toBe("Backups are kept for 3 day(s).");
    expect(
      outcome(
        database({ backupsEnabled: true, backupRetentionDays: 7 }),
        "no-backups",
      )[0],
    ).toBe(DataSecurityCheckStatus.Pass);
    expect(outcome(database({}), "no-backups")[0]).toBe(
      DataSecurityCheckStatus.NotApplicable,
    );
    expect(
      outcome(
        database({ backupsEnabled: null, backupRetentionDays: null }),
        "no-backups",
      )[0],
    ).toBe(DataSecurityCheckStatus.Unknown);
  });

  test("deleted-data-not-recoverable passes with versioning or soft delete", () => {
    const bucket: (
      versioning: boolean | null,
      softDelete: boolean | null,
    ) => DataStoreCheckInput = (
      versioning: boolean | null,
      softDelete: boolean | null,
    ): DataStoreCheckInput => {
      return store({
        posture: { readAt: NOW.toISOString(), versioning, softDelete },
      });
    };

    expect(
      outcome(bucket(true, false), "deleted-data-not-recoverable")[0],
    ).toBe(DataSecurityCheckStatus.Pass);
    expect(
      outcome(bucket(false, true), "deleted-data-not-recoverable")[0],
    ).toBe(DataSecurityCheckStatus.Pass);
    expect(
      outcome(bucket(false, false), "deleted-data-not-recoverable"),
    ).toEqual([DataSecurityCheckStatus.Fail, SecuritySeverity.Medium]);
    expect(
      outcome(bucket(false, null), "deleted-data-not-recoverable")[0],
    ).toBe(DataSecurityCheckStatus.Unknown);
  });

  test("many-readers fails above 25 readers, and cannot tell without access", () => {
    expect(outcome(store({ readerCount: 26 }), "many-readers")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.Medium,
    ]);
    expect(outcome(store({ readerCount: 25 }), "many-readers")[0]).toBe(
      DataSecurityCheckStatus.Pass,
    );
    expect(outcome(store({ readerCount: undefined }), "many-readers")[0]).toBe(
      DataSecurityCheckStatus.Unknown,
    );
  });

  test("the data hygiene checks read what was found", () => {
    expect(outcome(store(), "card-numbers-readable")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.High,
    ]);
    expect(
      outcome(
        store({ dataTypeIds: ["card-verification-code"] }),
        "card-security-codes-stored",
      ),
    ).toEqual([DataSecurityCheckStatus.Fail, SecuritySeverity.Critical]);
    expect(outcome(store(), "card-security-codes-stored")[0]).toBe(
      DataSecurityCheckStatus.Pass,
    );
    expect(
      evaluated(
        store({
          plaintextPasswordFields: ["users.password", "admins.pwd", "a", "b"],
        }),
        "plaintext-passwords",
      )?.result.evidence,
    ).toBe("Plain-text passwords in users.password, admins.pwd, a.");
    expect(outcome(store({ hasOwner: false }), "no-owner")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.Medium,
    ]);
    expect(
      outcome(
        store({ hasOwner: false, sensitivity: DataSensitivity.Public }),
        "no-owner",
      ),
    ).toEqual([DataSecurityCheckStatus.Fail, null]);
  });

  test("the telemetry checks split secrets from other sensitive data", () => {
    const logs: DataStoreCheckInput = store({
      kind: DataStoreKind.TelemetryLogs,
      unscrubbedDataTypeIds: ["email-address", "github-token", "us-ssn"],
      posture: {},
    });

    expect(
      evaluated(logs, "sensitive-data-in-telemetry")?.result.evidence,
    ).toBe("2 kind(s) of sensitive data are not scrubbed.");
    expect(outcome(logs, "secrets-in-telemetry")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.Critical,
    ]);
    expect(
      outcome(
        { ...logs, unscrubbedDataTypeIds: [] },
        "secrets-in-telemetry",
      )[0],
    ).toBe(DataSecurityCheckStatus.Pass);
  });

  test("the AI checks follow data to model providers and into AI stores", () => {
    const conversations: DataStoreCheckInput = store({
      kind: DataStoreKind.TelemetryAiConversations,
      aiProvidersReached: ["OpenAI", "Anthropic"],
      posture: {},
    });

    expect(
      evaluated(conversations, "sensitive-data-to-ai")?.result.evidence,
    ).toBe("Sent to OpenAI, Anthropic.");
    expect(outcome(conversations, "sensitive-data-to-ai")).toEqual([
      DataSecurityCheckStatus.Fail,
      SecuritySeverity.Critical,
    ]);
    expect(
      outcome({ ...conversations, dataTypeIds: [] }, "sensitive-data-to-ai")[0],
    ).toBe(DataSecurityCheckStatus.Pass);
    expect(
      outcome(store({ isAiData: true }), "sensitive-data-in-ai-store"),
    ).toEqual([DataSecurityCheckStatus.Fail, SecuritySeverity.High]);
    expect(outcome(store(), "sensitive-data-in-ai-store")[0]).toBe(
      DataSecurityCheckStatus.NotApplicable,
    );
  });
});

describe("checkAppliesToKind", () => {
  test("limits checks to the kinds and families they name", () => {
    const check: (id: string) => DataSecurityCheckInfo = (
      id: string,
    ): DataSecurityCheckInfo => {
      return getDataSecurityCheck(id)!;
    };

    expect(
      checkAppliesToKind(
        check("public-access-not-blocked"),
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBe(true);
    expect(
      checkAppliesToKind(
        check("public-access-not-blocked"),
        DataStoreKind.GcpStorageBucket,
      ),
    ).toBe(false);
    expect(
      checkAppliesToKind(
        check("internet-reachable"),
        DataStoreKind.AwsRdsInstance,
      ),
    ).toBe(true);
    expect(
      checkAppliesToKind(
        check("internet-reachable"),
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBe(false);
    expect(
      checkAppliesToKind(
        check("sensitive-data-to-ai"),
        DataStoreKind.TelemetryAiConversations,
      ),
    ).toBe(true);
    expect(
      checkAppliesToKind(
        check("sensitive-data-to-ai"),
        DataStoreKind.TelemetryLogs,
      ),
    ).toBe(false);
    expect(
      checkAppliesToKind(check("public-read"), DataStoreKind.TelemetryLogs),
    ).toBe(false);
  });

  test("applies a check with no kinds or families to every store", () => {
    for (const info of DATA_STORE_KINDS) {
      expect(
        checkAppliesToKind(getDataSecurityCheck("no-owner")!, info.kind),
      ).toBe(true);
    }
  });

  test("applies no family-bound check to a kind it does not know", () => {
    expect(
      checkAppliesToKind(
        getDataSecurityCheck("public-read")!,
        "Unknown store" as DataStoreKind,
      ),
    ).toBe(false);
  });

  test("runs only the checks that apply when a store is evaluated", () => {
    for (const each of evaluateDataStoreChecks(
      store({ kind: DataStoreKind.TelemetryTraces, posture: {} }),
    )) {
      expect([
        each.check.id,
        checkAppliesToKind(each.check, DataStoreKind.TelemetryTraces),
      ]).toEqual([each.check.id, true]);
    }
  });
});

describe("getCheckRemediation", () => {
  test("takes the kind's own steps, then the provider's, then the default", () => {
    const publicRead: DataSecurityCheckInfo =
      getDataSecurityCheck("public-read")!;
    const snapshotPublic: DataSecurityCheckInfo =
      getDataSecurityCheck("snapshot-public")!;

    expect(getCheckRemediation(publicRead, DataStoreKind.AwsS3Bucket)).toBe(
      publicRead.remediation[DataStoreKind.AwsS3Bucket],
    );
    expect(
      getCheckRemediation(publicRead, DataStoreKind.AwsOpenSearchDomain),
    ).toBe(publicRead.remediation.default);
    expect(
      getCheckRemediation(snapshotPublic, DataStoreKind.AwsRdsSnapshot),
    ).toBe(snapshotPublic.remediation[DataStoreProvider.Aws]);
    expect(
      getCheckRemediation(snapshotPublic, DataStoreKind.GcpCloudSqlInstance),
    ).toBe(snapshotPublic.remediation.default);
    expect(
      getCheckRemediation(
        getDataSecurityCheck("shared-key-access")!,
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBeUndefined();
  });
});

describe("fillRemediationText", () => {
  test("fills every {name} and {region}, and marks a missing region", () => {
    expect(
      fillRemediationText(
        "aws rds modify --id {name} --region {region} # {name}",
        {
          name: "orders-db",
          region: "eu-west-1",
        },
      ),
    ).toBe("aws rds modify --id orders-db --region eu-west-1 # orders-db");
    expect(fillRemediationText("--region {region}", { name: "x" })).toBe(
      "--region <region>",
    );
  });

  test("inserts values as they are, with no replacement patterns read in them", () => {
    expect(fillRemediationText("bucket {name}", { name: "$&-$1-weird" })).toBe(
      "bucket $&-$1-weird",
    );
  });

  test("fills a real command from the catalog", () => {
    const cli: string = getCheckRemediation(
      getDataSecurityCheck("public-read")!,
      DataStoreKind.AwsS3Bucket,
    )!.cli!;

    expect(fillRemediationText(cli, { name: "acme-exports" })).toContain(
      "--bucket acme-exports ",
    );
    expect(fillRemediationText(cli, { name: "acme-exports" })).not.toContain(
      "{",
    );
  });
});

describe("a store of every kind", () => {
  test("is evaluated without a check throwing, whatever its facts", () => {
    for (const info of DATA_STORE_KINDS as ReadonlyArray<DataStoreKindInfo>) {
      const results: Array<EvaluatedCheck> = evaluateDataStoreChecks(
        store({
          kind: info.kind,
          posture: {},
          lastActivityAt: null,
          readerCount: null,
        }),
      );

      for (const each of results) {
        expect(Object.values(DataSecurityCheckStatus)).toContain(
          each.result.status,
        );
      }
    }
  });
});
