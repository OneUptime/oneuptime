import { describe, expect, test } from "@jest/globals";
import InsightDetectors from "../../../../../Server/Utils/AI/Sentinel/Insights/Detectors/Index";
import { InsightDetector } from "../../../../../Server/Utils/AI/Sentinel/Insights/Types";
import SentinelInsightType from "../../../../../Types/AI/SentinelInsightType";

/*
 * Invariant under test: the detector registry returns exactly one detector
 * instance per SentinelInsightType — the scanner iterates this list, so a
 * missing entry silently disables a whole sensor and a duplicate would
 * double-emit candidates.
 */

describe("InsightDetectors.getAllDetectors", () => {
  test("registers exactly one detector per insight type", () => {
    const detectors: Array<InsightDetector> =
      InsightDetectors.getAllDetectors();

    const types: Array<SentinelInsightType> = detectors.map(
      (detector: InsightDetector) => {
        return detector.insightType;
      },
    );

    expect(detectors).toHaveLength(Object.values(SentinelInsightType).length);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(types)).toEqual(new Set(Object.values(SentinelInsightType)));
  });

  test("every registered detector exposes a detect function", () => {
    for (const detector of InsightDetectors.getAllDetectors()) {
      expect(typeof detector.detect).toBe("function");
    }
  });
});
