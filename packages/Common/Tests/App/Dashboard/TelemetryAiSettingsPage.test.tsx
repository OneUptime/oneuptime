import { describe, expect, jest, test } from "@jest/globals";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import {
  getTelemetryAiAdvancedItems,
  getTelemetryAiAdvancedSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiSettingsPage";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_RULES_CARD_TITLE,
  getTelemetryAiRulesTableId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import { TelemetryAiLane } from "../../../Types/AI/TelemetryAi";

/*
 * A telemetry product's AI → Settings folds its AI rules under More
 * settings (TelemetryAiSettingsPage): folded, the header names the rules
 * table - a chip with how many rules are on once there are any - and, with
 * none, says what OneUptime AI does without them. Nothing is said before
 * the rules have been counted.
 */

describe("the Profiler's AI settings, folded", () => {
  test("the rules table, by its title, set once a rule is on", () => {
    expect(getTelemetryAiAdvancedItems(TelemetryAiLane.Profile, null)).toEqual([
      {
        key: getTelemetryAiRulesTableId(TelemetryAiLane.Profile),
        title: TELEMETRY_AI_RULES_CARD_TITLE,
        isSet: false,
      },
    ]);
    expect(getTelemetryAiAdvancedItems(TelemetryAiLane.Profile, 0)).toEqual([
      {
        key: getTelemetryAiRulesTableId(TelemetryAiLane.Profile),
        title: TELEMETRY_AI_RULES_CARD_TITLE,
        isSet: false,
      },
    ]);
    expect(getTelemetryAiAdvancedItems(TelemetryAiLane.Profile, 3)).toEqual([
      {
        key: getTelemetryAiRulesTableId(TelemetryAiLane.Profile),
        title: TELEMETRY_AI_RULES_CARD_TITLE,
        isSet: true,
        value: "3",
      },
    ]);
  });

  test("what OneUptime AI does with no rule: said only once the rules are counted, and none is on", () => {
    expect(
      getTelemetryAiAdvancedSummary(TelemetryAiLane.Profile, null),
    ).toBeUndefined();
    expect(
      getTelemetryAiAdvancedSummary(TelemetryAiLane.Profile, 2),
    ).toBeUndefined();
    expect(getTelemetryAiAdvancedSummary(TelemetryAiLane.Profile, 0)).toBe(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].advancedDefaultsSummary,
    );
  });
});
