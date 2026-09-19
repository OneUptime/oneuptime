import { describe, expect, test } from "@jest/globals";
import {
  SIGMA_DEFAULT_LEVEL,
  SIGMA_LEVEL_TO_OCSF_SEVERITY,
  SIGMA_SUPPORTED_MODIFIERS,
  SigmaLevel,
  isSevereSigmaLevel,
} from "../../../Types/SecurityEvent/SigmaRule";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
  DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
  DETECTION_MAX_GROUPS_PER_EVALUATION,
  DETECTION_MAX_LOOKBACK_IN_MINUTES,
} from "../../../Types/SecurityEvent/DetectionFindingConstants";
import {
  THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
  THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES,
  THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES,
  THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION,
  THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
  THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
} from "../../../Types/SecurityEvent/ThreatIntelConstants";

/*
 * The Sigma level map, modifier list and engine limits used to be private
 * to the evaluator, parser and matcher. They now live in Types so the
 * dashboard's guides can render them — which makes them a contract, and
 * these are its invariants.
 */

const LEVELS_IN_RISING_ORDER: Array<SigmaLevel> = [
  SigmaLevel.Informational,
  SigmaLevel.Low,
  SigmaLevel.Medium,
  SigmaLevel.High,
  SigmaLevel.Critical,
];

describe("SIGMA_LEVEL_TO_OCSF_SEVERITY", () => {
  test("maps every Sigma level", () => {
    expect(Object.keys(SIGMA_LEVEL_TO_OCSF_SEVERITY).sort()).toEqual(
      Object.values(SigmaLevel).sort(),
    );
  });

  test("maps each level to the OCSF severity of the same name", () => {
    expect(SIGMA_LEVEL_TO_OCSF_SEVERITY).toEqual({
      [SigmaLevel.Informational]: OcsfSeverity.Informational,
      [SigmaLevel.Low]: OcsfSeverity.Low,
      [SigmaLevel.Medium]: OcsfSeverity.Medium,
      [SigmaLevel.High]: OcsfSeverity.High,
      [SigmaLevel.Critical]: OcsfSeverity.Critical,
    });
  });

  test("a more severe level never maps to a less severe OCSF severity", () => {
    const ids: Array<number> = LEVELS_IN_RISING_ORDER.map(
      (level: SigmaLevel): number => {
        return OcsfSeverityId[SIGMA_LEVEL_TO_OCSF_SEVERITY[level]];
      },
    );

    for (let index: number = 1; index < ids.length; index++) {
      expect(ids[index]!).toBeGreaterThan(ids[index - 1]!);
    }
  });
});

describe("isSevereSigmaLevel", () => {
  test.each(LEVELS_IN_RISING_ORDER)("%s", (level: SigmaLevel) => {
    expect(isSevereSigmaLevel(level)).toBe(
      level === SigmaLevel.High || level === SigmaLevel.Critical,
    );
  });
});

describe("SIGMA_DEFAULT_LEVEL", () => {
  test("is a real level, and the middle one", () => {
    expect(Object.values(SigmaLevel)).toContain(SIGMA_DEFAULT_LEVEL);
    expect(SIGMA_DEFAULT_LEVEL).toBe(SigmaLevel.Medium);
  });
});

describe("SIGMA_SUPPORTED_MODIFIERS", () => {
  test("has no duplicates and only lowercase names, as the parser lowercases input", () => {
    expect(new Set(SIGMA_SUPPORTED_MODIFIERS).size).toBe(
      SIGMA_SUPPORTED_MODIFIERS.length,
    );

    for (const modifier of SIGMA_SUPPORTED_MODIFIERS) {
      expect(modifier).toBe(modifier.toLowerCase());
    }
  });
});

describe("engine limits", () => {
  test("detection rule interval bounds are ordered and whole", () => {
    expect(Number.isInteger(DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES)).toBe(
      true,
    );
    expect(DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES).toBeGreaterThanOrEqual(
      1,
    );
    expect(DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES).toBeGreaterThan(
      DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
    );
  });

  test("a rule at its longest interval still fits in one lookback", () => {
    expect(DETECTION_MAX_LOOKBACK_IN_MINUTES).toBeGreaterThanOrEqual(
      DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
    );
  });

  test("threat intel's default poll interval is inside its bounds", () => {
    expect(
      THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
    ).toBeGreaterThanOrEqual(THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES);
    expect(THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES).toBeLessThanOrEqual(
      THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
    );
  });

  test("the matcher's first window fits inside its lookback cap", () => {
    expect(THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES).toBeLessThanOrEqual(
      THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES,
    );
  });

  test("per-run caps are positive whole numbers", () => {
    for (const cap of [
      DETECTION_MAX_GROUPS_PER_EVALUATION,
      THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION,
    ]) {
      expect(Number.isInteger(cap)).toBe(true);
      expect(cap).toBeGreaterThan(0);
    }
  });
});
