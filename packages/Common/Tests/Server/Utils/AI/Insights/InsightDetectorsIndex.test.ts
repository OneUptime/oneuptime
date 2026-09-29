import { describe, expect, test } from "@jest/globals";
import InsightDetectors from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/Index";
import { InsightDetector } from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import AIInsightType from "../../../../../Types/AI/AIInsightType";

/*
 * Invariant under test: the detector registry returns exactly one detector
 * instance per AIInsightType — the scanner iterates this list, so a
 * missing entry silently disables a whole sensor and a duplicate would
 * double-emit candidates.
 */

describe("InsightDetectors.getAllDetectors", () => {
  test("registers exactly one detector per insight type", () => {
    const detectors: Array<InsightDetector> =
      InsightDetectors.getAllDetectors();

    const types: Array<AIInsightType> = detectors.map(
      (detector: InsightDetector) => {
        return detector.insightType;
      },
    );

    expect(detectors).toHaveLength(Object.values(AIInsightType).length);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(types)).toEqual(new Set(Object.values(AIInsightType)));
  });

  test("every registered detector exposes a detect function", () => {
    for (const detector of InsightDetectors.getAllDetectors()) {
      expect(typeof detector.detect).toBe("function");
    }
  });
});
