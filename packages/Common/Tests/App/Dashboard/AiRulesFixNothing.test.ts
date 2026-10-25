import { describe, expect, test } from "@jest/globals";
import {
  AI_RULES_FIX_NOTHING_COPY,
  AiRulesFixNothingLaneKind,
  isAiRulesFixingNothing,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiRulesFixNothing";
import { AI_RULE_FIX_OPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiRuleCopy";
import { getTelemetryAiFixOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import {
  AiRuleFix,
  doesAiRuleFix,
  getFixingAiRules,
} from "../../../Types/AI/AiRule";
import {
  TELEMETRY_AI_LANE_LIST,
  TelemetryAiLane,
} from "../../../Types/AI/TelemetryAi";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";

/*
 * When every AI rule says Don't fix (AiRulesFixNothing): with rules,
 * OneUptime AI fixes only what a rule that fixes matches, so a lane whose
 * enabled rules all say Don't fix fixes nothing - while its switch ("Fix
 * new incidents automatically", "Find and fix slow code") still says it
 * fixes. The switch says so then, and only then.
 */

describe("whether a lane's rules fix nothing", () => {
  test("rules, none of which fixes: nothing is fixed", () => {
    expect(isAiRulesFixingNothing({ enabled: 1, fixing: 0 })).toBe(true);
    expect(isAiRulesFixingNothing({ enabled: 7, fixing: 0 })).toBe(true);
  });

  test("one rule that fixes is enough to fix what it matches", () => {
    expect(isAiRulesFixingNothing({ enabled: 1, fixing: 1 })).toBe(false);
    expect(isAiRulesFixingNothing({ enabled: 7, fixing: 1 })).toBe(false);
  });

  test("no enabled rule: every new one is fixed, as with no rules at all", () => {
    expect(isAiRulesFixingNothing({ enabled: 0, fixing: 0 })).toBe(false);
  });

  test("counts not read, or not counts, say nothing: no warning on a guess", () => {
    expect(isAiRulesFixingNothing(null)).toBe(false);
    expect(isAiRulesFixingNothing(undefined)).toBe(false);
    expect(
      isAiRulesFixingNothing({ enabled: Number.NaN, fixing: 0 } as never),
    ).toBe(false);
    expect(isAiRulesFixingNothing({ enabled: -1, fixing: 0 } as never)).toBe(
      false,
    );
    expect(isAiRulesFixingNothing({ enabled: 2, fixing: "0" } as never)).toBe(
      false,
    );
  });

  /*
   * The counts the page asks for are the rule engine's own reading: a rule
   * that fixes is one whose fixes is not false (doesAiRuleFix), so asking
   * for fixes: true counts exactly the rules getFixingAiRules keeps - the
   * column is NOT NULL, true or false.
   */
  test("the rules counted as fixing are the ones the engine fixes with", () => {
    const rules: Array<{ fixes: boolean }> = [
      { fixes: false },
      { fixes: true },
      { fixes: false },
    ];

    expect(getFixingAiRules(rules).length).toBe(
      rules.filter((rule: { fixes: boolean }): boolean => {
        return rule.fixes === true;
      }).length,
    );
    expect(doesAiRuleFix({ fixes: false })).toBe(false);
    expect(doesAiRuleFix({ fixes: true })).toBe(true);
  });
});

describe("what the switch says", () => {
  test("it names the answer as the rule's form draws it: Don't fix", () => {
    const dontFix: CardSelectOption | undefined = AI_RULE_FIX_OPTIONS.find(
      (option: CardSelectOption): boolean => {
        return option.value === AiRuleFix.DoNotFix;
      },
    );

    expect(dontFix?.title).toBe("Don't fix");

    for (const lane of TELEMETRY_AI_LANE_LIST) {
      expect(
        getTelemetryAiFixOptions(lane).find(
          (option: CardSelectOption): boolean => {
            return option.value === AiRuleFix.DoNotFix;
          },
        )?.title,
      ).toBe("Don't fix");
    }

    for (const sentence of Object.values(AI_RULES_FIX_NOTHING_COPY.sentence)) {
      expect(sentence).toContain(`says ${dontFix!.title},`);
    }
  });

  test("incidents and alerts: nothing is fixed; a telemetry lane: no pull request on its own", () => {
    expect(
      AI_RULES_FIX_NOTHING_COPY.sentence[AiRulesFixNothingLaneKind.Signal],
    ).toBe("Every AI rule says Don't fix, so nothing is fixed.");
    expect(
      AI_RULES_FIX_NOTHING_COPY.sentence[AiRulesFixNothingLaneKind.Telemetry],
    ).toBe(
      "Every AI rule says Don't fix, so OneUptime AI opens no pull request on its own.",
    );
    expect(AI_RULES_FIX_NOTHING_COPY.link).toBe("Review the AI rules");
  });

  test("each line is short: one line under a switch, and its link two words more", () => {
    for (const sentence of Object.values(AI_RULES_FIX_NOTHING_COPY.sentence)) {
      expect(sentence.length).toBeLessThanOrEqual(100);
      expect(sentence.endsWith(".")).toBe(true);
    }

    expect(AI_RULES_FIX_NOTHING_COPY.link.length).toBeLessThanOrEqual(30);
    // The Profile lane is a telemetry lane, as the others.
    expect(TELEMETRY_AI_LANE_LIST).toContain(TelemetryAiLane.Profile);
  });
});
