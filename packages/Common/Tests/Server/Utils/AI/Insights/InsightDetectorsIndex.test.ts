import { describe, expect, test } from "@jest/globals";
import InsightDetectors from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/Index";
import { InsightDetector } from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_LANE_LIST,
  TelemetryAiLane,
  getTelemetryAiInsightTypes,
  isTelemetryAiInsightTypeSharedWithAiInsights,
} from "../../../../../Types/AI/TelemetryAi";

/*
 * Invariant under test: the detector registry returns exactly one detector
 * instance per AIInsightType — the scanner iterates this list, so a
 * missing entry silently disables a whole sensor and a duplicate would
 * double-emit candidates. AI Insights' own detectors run under "Watch
 * telemetry for problems"; a telemetry product's AI section (Types/AI/
 * TelemetryAi) brings its own, run under its own switch: between them,
 * every insight type has exactly one. The kinds a lane shares with AI
 * Insights (new and spiking exceptions, the Exceptions lane's) are on both
 * lists - one detector each, which the scanner runs once a look
 * (InsightScanner.getDetectorsForProject).
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

    // Twice only the kinds AI Insights shares with a lane, once all others.
    const shared: Array<AIInsightType> = Object.values(AIInsightType).filter(
      (type: AIInsightType): boolean => {
        return isTelemetryAiInsightTypeSharedWithAiInsights(type);
      },
    );

    expect(detectors).toHaveLength(
      Object.values(AIInsightType).length + shared.length,
    );
    expect(new Set(types).size).toBe(types.length - shared.length);
    expect(new Set(types)).toEqual(new Set(Object.values(AIInsightType)));

    for (const type of Object.values(AIInsightType)) {
      expect(
        types.filter((candidate: AIInsightType): boolean => {
          return candidate === type;
        }),
      ).toHaveLength(shared.includes(type) ? 2 : 1);
    }
  });

  test("AI Insights' own list holds no telemetry lane's detector, but the kinds a lane shares with it", () => {
    const laneTypes: Array<AIInsightType> = getTelemetryAiInsightTypes();

    for (const detector of InsightDetectors.getAllDetectors()) {
      if (laneTypes.includes(detector.insightType)) {
        expect(
          isTelemetryAiInsightTypeSharedWithAiInsights(detector.insightType),
        ).toBe(true);
      }
    }

    // New and spiking exceptions: found by AI Insights while Exceptions' AI is off.
    expect(
      InsightDetectors.getAllDetectors()
        .map((detector: InsightDetector): AIInsightType => {
          return detector.insightType;
        })
        .filter((type: AIInsightType): boolean => {
          return laneTypes.includes(type);
        }),
    ).toEqual([AIInsightType.NewException, AIInsightType.ExceptionSpike]);
  });

  test("the Exceptions lane's detectors: new, rising, and missing stack traces", () => {
    expect(
      InsightDetectors.getTelemetryAiDetectors(TelemetryAiLane.Exception).map(
        (detector: InsightDetector): AIInsightType => {
          return detector.insightType;
        },
      ),
    ).toEqual([
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
      AIInsightType.ExceptionMissingStackTrace,
    ]);
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

  test("every registered detector exposes a detect function", () => {
    for (const detector of everyDetector()) {
      expect(typeof detector.detect).toBe("function");
    }
  });
});
