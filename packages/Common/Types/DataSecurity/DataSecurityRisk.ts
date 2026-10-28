import SecuritySeverity from "../SecuritySeverity";
import DataCategory from "./DataCategory";
import DataConfidence, { isConfidentEnough } from "./DataConfidence";
import {
  DataTypeInfo,
  getBuiltInDataType,
} from "./DataTypeCatalog";
import DataSensitivity, { moreSensitive } from "./DataSensitivity";
import {
  DATA_STORE_EXPOSURE_WEIGHT,
  DataStoreExposure,
} from "./DataStorePosture";

/*
 * HOW SENSITIVE A STORE IS, AND HOW RISKY EACH OF ITS ISSUES IS.
 *
 * A store is as sensitive as the most sensitive data type found in it with
 * at least Medium confidence; findings marked "not sensitive" and test data
 * count for nothing. A custom data type carries the sensitivity its project
 * gave it.
 *
 * An issue's severity comes from its check and the store's sensitivity
 * (DataSecurityCheckCatalog.ts); its risk score orders issues inside a
 * severity, from what makes the same misconfiguration worse - exposure,
 * volume, activity, production - so the page can show each part:
 *
 *   risk = base(severity) + 10 x exposure + 6 x volume + 5 x activity
 *          + 4 x production, at most 100
 *
 * with base 75 for Critical, 50 for High, 25 for Medium and 0 for Low,
 * exposure from DATA_STORE_EXPOSURE_WEIGHT, volume the estimated record
 * count on a log scale (1 at ten million records), activity 1 when
 * Security Operations saw detections on the store in the last week, and
 * production 1 for a production store.
 */

export interface SensitivityFinding {
  dataTypeId: string;
  confidence: DataConfidence;
  isSuppressed?: boolean | undefined;
  // For a custom data type: the sensitivity and category its project set.
  customSensitivity?: DataSensitivity | undefined;
  customCategory?: DataCategory | undefined;
}

export interface StoreSensitivity {
  sensitivity: DataSensitivity;
  dataTypeIds: Array<string>;
  dataCategories: Array<DataCategory>;
}

export function getStoreSensitivity(
  findings: ReadonlyArray<SensitivityFinding>,
): StoreSensitivity {
  let sensitivity: DataSensitivity = DataSensitivity.Public;
  const dataTypeIds: Set<string> = new Set();
  const dataCategories: Set<DataCategory> = new Set();

  for (const finding of findings) {
    if (finding.isSuppressed || !isConfidentEnough(finding.confidence)) {
      continue;
    }

    const info: DataTypeInfo | undefined = getBuiltInDataType(
      finding.dataTypeId,
    );
    const level: DataSensitivity | undefined =
      finding.customSensitivity || info?.sensitivity;
    const category: DataCategory | undefined =
      finding.customCategory || info?.category;

    if (!level) {
      continue;
    }

    sensitivity = moreSensitive(sensitivity, level);
    dataTypeIds.add(finding.dataTypeId);

    if (category) {
      dataCategories.add(category);
    }
  }

  return {
    sensitivity,
    dataTypeIds: [...dataTypeIds].sort(),
    dataCategories: [...dataCategories].sort(),
  };
}

export const RISK_BASE_BY_SEVERITY: Readonly<Record<SecuritySeverity, number>> =
  {
    [SecuritySeverity.Critical]: 75,
    [SecuritySeverity.High]: 50,
    [SecuritySeverity.Medium]: 25,
    [SecuritySeverity.Low]: 0,
  };

export interface RiskScoreInput {
  severity: SecuritySeverity;
  exposure: DataStoreExposure;
  estimatedRecords?: number | null | undefined;
  hasRecentSecurityActivity?: boolean | undefined;
  isProduction?: boolean | undefined;
}

export interface RiskScoreFactor {
  // What the factor is, in words for the issue page.
  label: string;
  points: number;
}

export interface RiskScore {
  score: number;
  factors: Array<RiskScoreFactor>;
}

// Records on a log scale: 0 for none, 1 at ten million or more.
export function volumeWeight(records: number | null | undefined): number {
  if (!records || records <= 1) {
    return 0;
  }

  return Math.min(1, Math.log10(records) / 7);
}

export function getRiskScore(input: RiskScoreInput): RiskScore {
  const factors: Array<RiskScoreFactor> = [
    {
      label: `${input.severity} severity`,
      points: RISK_BASE_BY_SEVERITY[input.severity],
    },
  ];

  const exposurePoints: number = Math.round(
    10 * DATA_STORE_EXPOSURE_WEIGHT[input.exposure],
  );

  if (exposurePoints > 0) {
    factors.push({ label: `Exposure: ${input.exposure}`, points: exposurePoints });
  }

  const volumePoints: number = Math.round(
    6 * volumeWeight(input.estimatedRecords),
  );

  if (volumePoints > 0) {
    factors.push({
      label: "Number of records it holds",
      points: volumePoints,
    });
  }

  if (input.hasRecentSecurityActivity) {
    factors.push({
      label: "Security Operations saw activity on it this week",
      points: 5,
    });
  }

  if (input.isProduction) {
    factors.push({ label: "Production store", points: 4 });
  }

  const total: number = factors.reduce((sum: number, factor: RiskScoreFactor) => {
    return sum + factor.points;
  }, 0);

  return { score: Math.min(100, total), factors };
}

// The more severe of two severities; null counts as no severity at all.
export function moreSevere(
  a: SecuritySeverity | null | undefined,
  b: SecuritySeverity | null | undefined,
): SecuritySeverity | null {
  if (!a) {
    return b || null;
  }

  if (!b) {
    return a;
  }

  return RISK_BASE_BY_SEVERITY[a] >= RISK_BASE_BY_SEVERITY[b] ? a : b;
}

export const SEVERITIES_MOST_SEVERE_FIRST: ReadonlyArray<SecuritySeverity> = [
  SecuritySeverity.Critical,
  SecuritySeverity.High,
  SecuritySeverity.Medium,
  SecuritySeverity.Low,
];
