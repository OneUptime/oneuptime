import { describe, expect, test } from "@jest/globals";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_INFO,
  isComplianceFramework,
} from "../../../Types/DataSecurity/ComplianceFramework";
import DataCategory, {
  ALL_DATA_CATEGORIES,
  DATA_CATEGORY_DESCRIPTION,
  isDataCategory,
  isPersonalDataCategory,
  PERSONAL_DATA_CATEGORIES,
} from "../../../Types/DataSecurity/DataCategory";
import DataConfidence, {
  ALL_DATA_CONFIDENCES,
  DATA_CONFIDENCE_RANK,
  higherConfidence,
  isConfidentEnough,
  isDataConfidence,
} from "../../../Types/DataSecurity/DataConfidence";
import DataSecurityIssueStatus, {
  ALL_DATA_SECURITY_ISSUE_STATUSES,
  isActiveIssueStatus,
  isDataSecurityIssueStatus,
} from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataSensitivity, {
  ALL_DATA_SENSITIVITIES,
  DATA_SENSITIVITY_DESCRIPTION,
  DATA_SENSITIVITY_RANK,
  isAtLeastAsSensitive,
  isDataSensitivity,
  moreSensitive,
} from "../../../Types/DataSecurity/DataSensitivity";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
  getDataStoreAccessKey,
} from "../../../Types/DataSecurity/DataStoreAccess";

/*
 * THE SMALL TYPES DATA SECURITY IS BUILT ON: SENSITIVITY, CONFIDENCE,
 * CATEGORY, FRAMEWORK, ISSUE STATUS AND ACCESS.
 */

describe("DataSensitivity", () => {
  test("ranks the levels in the order lists show them, most sensitive first", () => {
    const ranks: Array<number> = ALL_DATA_SENSITIVITIES.map(
      (level: DataSensitivity) => {
        return DATA_SENSITIVITY_RANK[level];
      },
    );

    expect(ranks).toEqual([3, 2, 1, 0]);
    expect(ALL_DATA_SENSITIVITIES[0]).toBe(DataSensitivity.Restricted);

    for (const level of ALL_DATA_SENSITIVITIES) {
      expect(DATA_SENSITIVITY_DESCRIPTION[level].length).toBeGreaterThan(0);
    }
  });

  test("moreSensitive takes the higher level, and reads nothing as Public", () => {
    expect(
      moreSensitive(DataSensitivity.Internal, DataSensitivity.Restricted),
    ).toBe(DataSensitivity.Restricted);
    expect(
      moreSensitive(DataSensitivity.Confidential, DataSensitivity.Internal),
    ).toBe(DataSensitivity.Confidential);
    expect(moreSensitive(null, DataSensitivity.Internal)).toBe(
      DataSensitivity.Internal,
    );
    expect(moreSensitive(DataSensitivity.Internal, undefined)).toBe(
      DataSensitivity.Internal,
    );
    expect(moreSensitive(null, undefined)).toBe(DataSensitivity.Public);
  });

  test("isAtLeastAsSensitive compares levels, reading nothing as Public", () => {
    expect(
      isAtLeastAsSensitive(
        DataSensitivity.Restricted,
        DataSensitivity.Confidential,
      ),
    ).toBe(true);
    expect(
      isAtLeastAsSensitive(
        DataSensitivity.Confidential,
        DataSensitivity.Confidential,
      ),
    ).toBe(true);
    expect(
      isAtLeastAsSensitive(
        DataSensitivity.Internal,
        DataSensitivity.Confidential,
      ),
    ).toBe(false);
    expect(isAtLeastAsSensitive(null, DataSensitivity.Public)).toBe(true);
    expect(isAtLeastAsSensitive(undefined, DataSensitivity.Internal)).toBe(
      false,
    );
  });

  test("isDataSensitivity takes the levels only", () => {
    expect(isDataSensitivity("Restricted")).toBe(true);
    expect(isDataSensitivity("restricted")).toBe(false);
    expect(isDataSensitivity(3)).toBe(false);
    expect(isDataSensitivity(null)).toBe(false);
  });
});

describe("DataConfidence", () => {
  test("ranks Low below Medium below High", () => {
    expect(DATA_CONFIDENCE_RANK[DataConfidence.Low]).toBeLessThan(
      DATA_CONFIDENCE_RANK[DataConfidence.Medium],
    );
    expect(DATA_CONFIDENCE_RANK[DataConfidence.Medium]).toBeLessThan(
      DATA_CONFIDENCE_RANK[DataConfidence.High],
    );
    expect(ALL_DATA_CONFIDENCES).toEqual([
      DataConfidence.High,
      DataConfidence.Medium,
      DataConfidence.Low,
    ]);
  });

  test("higherConfidence takes the surer of two", () => {
    expect(higherConfidence(DataConfidence.Low, DataConfidence.High)).toBe(
      DataConfidence.High,
    );
    expect(higherConfidence(DataConfidence.Medium, DataConfidence.Low)).toBe(
      DataConfidence.Medium,
    );
    expect(higherConfidence(DataConfidence.Low, DataConfidence.Low)).toBe(
      DataConfidence.Low,
    );
  });

  test("isConfidentEnough counts Medium and High toward a store, never Low", () => {
    expect(ALL_DATA_CONFIDENCES.filter(isConfidentEnough)).toEqual([
      DataConfidence.High,
      DataConfidence.Medium,
    ]);
  });

  test("isDataConfidence takes the levels only", () => {
    expect(isDataConfidence("Medium")).toBe(true);
    expect(isDataConfidence("medium")).toBe(false);
    expect(isDataConfidence(undefined)).toBe(false);
  });
});

describe("DataCategory", () => {
  test("describes every category, and knows which are about people", () => {
    for (const category of ALL_DATA_CATEGORIES) {
      expect(DATA_CATEGORY_DESCRIPTION[category].length).toBeGreaterThan(0);
      expect(isDataCategory(category)).toBe(true);
    }

    expect(ALL_DATA_CATEGORIES.filter(isPersonalDataCategory)).toEqual(
      expect.arrayContaining([...PERSONAL_DATA_CATEGORIES]),
    );
    expect(isPersonalDataCategory(DataCategory.SecretsAndCredentials)).toBe(
      false,
    );
    expect(isPersonalDataCategory(DataCategory.BusinessConfidential)).toBe(
      false,
    );
    expect(isPersonalDataCategory(DataCategory.Health)).toBe(true);
    expect(isDataCategory("Secrets")).toBe(false);
  });
});

describe("ComplianceFramework", () => {
  test("describes every framework, and only the security ones cover every store", () => {
    for (const framework of ALL_COMPLIANCE_FRAMEWORKS) {
      const info: (typeof COMPLIANCE_FRAMEWORK_INFO)[ComplianceFramework] =
        COMPLIANCE_FRAMEWORK_INFO[framework];

      expect(info.framework).toBe(framework);
      expect(info.fullName.length).toBeGreaterThan(0);
      expect(info.scope.length).toBeGreaterThan(0);
      expect(isComplianceFramework(framework)).toBe(true);
    }

    expect(isComplianceFramework("PCI")).toBe(false);
    expect(
      COMPLIANCE_FRAMEWORK_INFO[ComplianceFramework.GDPR].appliesToEveryStore,
    ).toBe(false);
    expect(
      COMPLIANCE_FRAMEWORK_INFO[ComplianceFramework.ISO27001]
        .appliesToEveryStore,
    ).toBe(true);
  });
});

describe("DataSecurityIssueStatus", () => {
  test("only an open issue needs attention", () => {
    expect(
      ALL_DATA_SECURITY_ISSUE_STATUSES.filter(isActiveIssueStatus),
    ).toEqual([DataSecurityIssueStatus.Open]);
    expect(isActiveIssueStatus(undefined)).toBe(false);
  });

  test("isDataSecurityIssueStatus takes the statuses only", () => {
    for (const status of ALL_DATA_SECURITY_ISSUE_STATUSES) {
      expect(isDataSecurityIssueStatus(status)).toBe(true);
    }

    expect(isDataSecurityIssueStatus("Closed")).toBe(false);
    expect(isDataSecurityIssueStatus(1)).toBe(false);
  });
});

describe("getDataStoreAccessKey", () => {
  const entry: DataStoreAccessEntry = {
    principal: "arn:aws:iam::123456789012:role/analytics",
    principalType: DataStorePrincipalType.Role,
    accessLevel: DataStoreAccessLevel.Read,
    grantedVia: "Bucket policy",
    isExternal: false,
    isPublic: false,
  };

  test("is one key per principal, level and grant", () => {
    expect(getDataStoreAccessKey(entry)).toBe(
      "arn:aws:iam::123456789012:role/analytics|Read|Bucket policy",
    );
    expect(
      getDataStoreAccessKey({
        ...entry,
        accessLevel: DataStoreAccessLevel.Write,
      }),
    ).not.toBe(getDataStoreAccessKey(entry));
    expect(
      getDataStoreAccessKey({
        ...entry,
        principalName: "Analytics",
        isSeenInTraces: true,
      }),
    ).toBe(getDataStoreAccessKey(entry));
  });

  test("is at most 500 characters", () => {
    expect(
      getDataStoreAccessKey({ ...entry, principal: "p".repeat(600) }),
    ).toHaveLength(500);
  });
});
