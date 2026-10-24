import { describe, expect, test } from "@jest/globals";
import InsightDetectors from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/Index";
import { InsightDetector } from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_LANE_LIST,
  TelemetryAiLane,
  getTelemetryAiInsightTypes,
} from "../../../../../Types/AI/TelemetryAi";

/*
 * Invariant under test: the detector registry returns exactly one detector
 * instance per AIInsightType — the scanner iterates this list, so a
 * missing entry silently disables a whole sensor and a duplicate would
 * double-emit candidates. AI Insights' own detectors run under "Watch
 * telemetry for problems"; a telemetry product's AI section (Types/AI/
 * TelemetryAi) brings its own, run under its own switch: between them,
 * every insight type has exactly one.
 */

function everyDetector(): Array<InsightDetector> {
  return [
    ...InsightDetectors.getAllDetectors(),
    ...TELEMETRY_AI_LANE_LIST.flatMap(
      (lane: TelemetryAiLane): Array<InsightDetector> => {
        return InsightDetectors.getTelemetryAiDetectors(lane);
      },
    ),
  ];
}

describe("InsightDetectors.getAllDetectors", () => {
  test("registers exactly one detector per insight type, AI Insights' and the lanes' together", () => {
    const detectors: Array<InsightDetector> = everyDetector();

    const types: Array<AIInsightType> = detectors.map(
      (detector: InsightDetector) => {
        return detector.insightType;
      },
    );

    expect(detectors).toHaveLength(Object.values(AIInsightType).length);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(types)).toEqual(new Set(Object.values(AIInsightType)));
  });

  test("AI Insights' own list holds no telemetry lane's detector", () => {
    const laneTypes: Array<AIInsightType> = getTelemetryAiInsightTypes();

    for (const detector of InsightDetectors.getAllDetectors()) {
      expect(laneTypes).not.toContain(detector.insightType);
    }
  });

  test("each lane's detectors file exactly the lane's insight types", () => {
    for (const lane of TELEMETRY_AI_LANE_LIST) {
      const types: Array<AIInsightType> =
        InsightDetectors.getTelemetryAiDetectors(lane).map(
          (detector: InsightDetector): AIInsightType => {
            return detector.insightType;
          },
        );

      expect([...types].sort()).toEqual(
        [...TELEMETRY_AI_LANES[lane].insightTypes].sort(),
      );
    }
  });

  test("Profiles' detector finds slow code", () => {
    expect(
      InsightDetectors.getTelemetryAiDetectors(TelemetryAiLane.Profile).map(
        (detector: InsightDetector): AIInsightType => {
          return detector.insightType;
        },
      ),
    ).toEqual([AIInsightType.ProfileHotspot]);
  });

  test("Metrics' detectors find high cardinality, histogram buckets that do not fit and missing metrics; the drift detector stays AI Insights'", () => {
    expect(
      InsightDetectors.getTelemetryAiDetectors(TelemetryAiLane.Metric).map(
        (detector: InsightDetector): AIInsightType => {
          return detector.insightType;
        },
      ),
    ).toEqual([
      AIInsightType.MetricHighCardinality,
      AIInsightType.MetricHistogramBuckets,
      AIInsightType.MetricMissingMetrics,
    ]);
    expect(
      InsightDetectors.getAllDetectors().map(
        (detector: InsightDetector): AIInsightType => {
          return detector.insightType;
        },
      ),
    ).toContain(AIInsightType.MetricDrift);
  });

  test("every registered detector exposes a detect function", () => {
    for (const detector of everyDetector()) {
      expect(typeof detector.detect).toBe("function");
    }
  });
});
