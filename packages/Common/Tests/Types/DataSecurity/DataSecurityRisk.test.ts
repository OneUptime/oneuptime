import { describe, expect, test } from "@jest/globals";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  getRiskScore,
  getStoreSensitivity,
  moreSevere,
  RISK_BASE_BY_SEVERITY,
  RiskScore,
  SEVERITIES_MOST_SEVERE_FIRST,
  StoreSensitivity,
  volumeWeight,
} from "../../../Types/DataSecurity/DataSecurityRisk";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { DataStoreExposure } from "../../../Types/DataSecurity/DataStorePosture";
import {
  classifyField,
  FieldClassification,
} from "../../../Utils/DataSecurity/FieldClassifier";

/*
 * HOW SENSITIVE A STORE IS, AND HOW RISKY AN ISSUE ON IT IS.
 *
 * A store is as sensitive as its most sensitive finding of at least Medium
 * confidence that nobody marked not sensitive; an issue's risk is its
 * severity's base plus what makes the same mistake worse, at most 100.
 */

describe("getStoreSensitivity", () => {
  test("is the most sensitive confident finding's level, with its types and categories", () => {
    const sensitivity: StoreSensitivity = getStoreSensitivity([
      { dataTypeId: "email-address", confidence: DataConfidence.High },
      { dataTypeId: "postal-code", confidence: DataConfidence.Medium },
      { dataTypeId: "credit-card-number", confidence: DataConfidence.Medium },
      { dataTypeId: "email-address", confidence: DataConfidence.Medium },
    ]);

    expect(sensitivity).toEqual({
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["credit-card-number", "email-address", "postal-code"],
      dataCategories: [DataCategory.ContactAndIdentity, DataCategory.Financial],
    });
  });

  test("leaves out Low findings and findings marked not sensitive", () => {
    expect(
      getStoreSensitivity([
        { dataTypeId: "credit-card-number", confidence: DataConfidence.Low },
        {
          dataTypeId: "us-ssn",
          confidence: DataConfidence.High,
          isSuppressed: true,
        },
        { dataTypeId: "email-address", confidence: DataConfidence.Medium },
      ]),
    ).toEqual({
      sensitivity: DataSensitivity.Confidential,
      dataTypeIds: ["email-address"],
      dataCategories: [DataCategory.ContactAndIdentity],
    });
  });

  test("is Public with nothing confident in it", () => {
    expect(getStoreSensitivity([])).toEqual({
      sensitivity: DataSensitivity.Public,
      dataTypeIds: [],
      dataCategories: [],
    });
  });

  test("counts nothing for a column of test values, which classify Low", () => {
    const testCards: Array<FieldClassification> = classifyField("card_number", [
      "4242424242424242",
      "4111111111111111",
    ]);

    expect(
      testCards.map((result: FieldClassification) => {
        return [result.dataTypeId, result.matchCount, result.confidence];
      }),
    ).toEqual([["credit-card-number", 0, DataConfidence.Low]]);
    expect(getStoreSensitivity(testCards).sensitivity).toBe(
      DataSensitivity.Public,
    );
  });

  test("takes a custom type's sensitivity and category from its project", () => {
    expect(
      getStoreSensitivity([
        {
          dataTypeId: "custom:employee-id",
          confidence: DataConfidence.High,
          customSensitivity: DataSensitivity.Internal,
          customCategory: DataCategory.BusinessConfidential,
        },
      ]),
    ).toEqual({
      sensitivity: DataSensitivity.Internal,
      dataTypeIds: ["custom:employee-id"],
      dataCategories: [DataCategory.BusinessConfidential],
    });
  });

  test("lets a project make a built-in type more or less sensitive", () => {
    expect(
      getStoreSensitivity([
        {
          dataTypeId: "postal-code",
          confidence: DataConfidence.High,
          customSensitivity: DataSensitivity.Restricted,
        },
      ]).sensitivity,
    ).toBe(DataSensitivity.Restricted);
  });

  test("skips a type it knows nothing about", () => {
    expect(
      getStoreSensitivity([
        { dataTypeId: "custom:deleted", confidence: DataConfidence.High },
      ]),
    ).toEqual({
      sensitivity: DataSensitivity.Public,
      dataTypeIds: [],
      dataCategories: [],
    });
  });
});

describe("volumeWeight", () => {
  test("is 0 for no records and 1 at ten million, on a log scale", () => {
    expect(volumeWeight(null)).toBe(0);
    expect(volumeWeight(undefined)).toBe(0);
    expect(volumeWeight(0)).toBe(0);
    expect(volumeWeight(1)).toBe(0);
    expect(volumeWeight(-5)).toBe(0);
    expect(volumeWeight(10)).toBeCloseTo(1 / 7);
    expect(volumeWeight(10_000)).toBeCloseTo(4 / 7);
    expect(volumeWeight(10_000_000)).toBe(1);
    expect(volumeWeight(10_000_000_000)).toBe(1);
  });
});

describe("getRiskScore", () => {
  test("starts from the severity's base and lists it as a factor", () => {
    for (const severity of SEVERITIES_MOST_SEVERE_FIRST) {
      expect(
        getRiskScore({ severity, exposure: DataStoreExposure.Private }),
      ).toEqual({
        score: RISK_BASE_BY_SEVERITY[severity],
        factors: [
          {
            label: `${severity} severity`,
            points: RISK_BASE_BY_SEVERITY[severity],
          },
        ],
      });
    }

    expect(RISK_BASE_BY_SEVERITY).toEqual({
      [SecuritySeverity.Critical]: 75,
      [SecuritySeverity.High]: 50,
      [SecuritySeverity.Medium]: 25,
      [SecuritySeverity.Low]: 0,
    });
  });

  test("adds ten times the exposure's weight", () => {
    const points: (exposure: DataStoreExposure) => number = (
      exposure: DataStoreExposure,
    ): number => {
      return getRiskScore({ severity: SecuritySeverity.Low, exposure }).score;
    };

    expect(points(DataStoreExposure.Public)).toBe(10);
    expect(points(DataStoreExposure.OtherAccounts)).toBe(8);
    expect(points(DataStoreExposure.InternetReachable)).toBe(6);
    expect(points(DataStoreExposure.Unknown)).toBe(3);
    expect(points(DataStoreExposure.Private)).toBe(0);
  });

  test("adds the volume, recent activity and production, each as its own factor", () => {
    const risk: RiskScore = getRiskScore({
      severity: SecuritySeverity.High,
      exposure: DataStoreExposure.InternetReachable,
      estimatedRecords: 1_000,
      hasRecentSecurityActivity: true,
      isProduction: true,
    });

    expect(risk).toEqual({
      score: 50 + 6 + 3 + 5 + 4,
      factors: [
        { label: "High severity", points: 50 },
        { label: "Exposure: Internet reachable", points: 6 },
        { label: "Number of records it holds", points: 3 },
        {
          label: "Security Operations saw activity on it this week",
          points: 5,
        },
        { label: "Production store", points: 4 },
      ],
    });
  });

  test("lists no factor that adds nothing", () => {
    expect(
      getRiskScore({
        severity: SecuritySeverity.Medium,
        exposure: DataStoreExposure.Private,
        estimatedRecords: 1,
        hasRecentSecurityActivity: false,
        isProduction: false,
      }).factors,
    ).toEqual([{ label: "Medium severity", points: 25 }]);
  });

  test("is 100 at most, which the worst issue reaches", () => {
    const worst: RiskScore = getRiskScore({
      severity: SecuritySeverity.Critical,
      exposure: DataStoreExposure.Public,
      estimatedRecords: 50_000_000,
      hasRecentSecurityActivity: true,
      isProduction: true,
    });

    expect(worst.score).toBe(100);

    for (const severity of SEVERITIES_MOST_SEVERE_FIRST) {
      for (const exposure of Object.values(DataStoreExposure)) {
        expect(
          getRiskScore({
            severity,
            exposure,
            estimatedRecords: 10 ** 12,
            hasRecentSecurityActivity: true,
            isProduction: true,
          }).score,
        ).toBeLessThanOrEqual(100);
      }
    }
  });

  test("never lifts an issue above a bare issue of the next severity", () => {
    const lowest: (severity: SecuritySeverity) => number = (
      severity: SecuritySeverity,
    ): number => {
      return getRiskScore({ severity, exposure: DataStoreExposure.Private })
        .score;
    };
    const highest: (severity: SecuritySeverity) => number = (
      severity: SecuritySeverity,
    ): number => {
      return getRiskScore({
        severity,
        exposure: DataStoreExposure.Public,
        estimatedRecords: 10 ** 9,
        hasRecentSecurityActivity: true,
        isProduction: true,
      }).score;
    };

    // Everything else adds 25 at most: exactly the gap between two bases.
    expect(highest(SecuritySeverity.High)).toBeLessThanOrEqual(
      lowest(SecuritySeverity.Critical),
    );
    expect(highest(SecuritySeverity.Medium)).toBeLessThanOrEqual(
      lowest(SecuritySeverity.High),
    );
    expect(highest(SecuritySeverity.Low)).toBeLessThanOrEqual(
      lowest(SecuritySeverity.Medium),
    );
  });
});

describe("moreSevere", () => {
  test("is the more severe of two, and null only when both are", () => {
    expect(moreSevere(SecuritySeverity.High, SecuritySeverity.Critical)).toBe(
      SecuritySeverity.Critical,
    );
    expect(moreSevere(SecuritySeverity.Medium, SecuritySeverity.Low)).toBe(
      SecuritySeverity.Medium,
    );
    expect(moreSevere(SecuritySeverity.Low, SecuritySeverity.Low)).toBe(
      SecuritySeverity.Low,
    );
    expect(moreSevere(null, SecuritySeverity.Low)).toBe(SecuritySeverity.Low);
    expect(moreSevere(SecuritySeverity.High, undefined)).toBe(
      SecuritySeverity.High,
    );
    expect(moreSevere(null, undefined)).toBeNull();
  });

  test("orders the severities most severe first", () => {
    expect(SEVERITIES_MOST_SEVERE_FIRST).toEqual([
      SecuritySeverity.Critical,
      SecuritySeverity.High,
      SecuritySeverity.Medium,
      SecuritySeverity.Low,
    ]);
  });
});
