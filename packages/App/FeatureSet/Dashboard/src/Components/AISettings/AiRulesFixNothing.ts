import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHEN EVERY AI RULE SAYS DON'T FIX.
 *
 * With AI rules, OneUptime AI fixes only what a rule that fixes matches
 * (Common/Types/AI/AiRule): an incident that matches only rules that say
 * Don't fix is investigated and not fixed, and one that matches none is
 * neither. So once every enabled rule says Don't fix, nothing is fixed -
 * while "Fix new incidents automatically" stays on and still says it fixes
 * each new incident. The telemetry lanes the same: "Find and fix slow code"
 * finds and looks into it, and opens no pull request on its own.
 *
 * The switch says so, under its sentences, while it is on (ModelSwitchRow's
 * getWarning), with the way to the rules. Pure and React-free: the pages,
 * the tests and the docs suites read these exact words.
 */

// What the lane's enabled rules are, as counted.
export interface AiRuleFixCounts {
  // Enabled rules of the lane.
  enabled: number;
  // Of them, the ones that fix what they match (fixes is not false).
  fixing: number;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/*
 * Whether the rules leave nothing to fix: at least one enabled rule, and
 * none of them fixes. Counts not read (or not counts) say nothing: a
 * warning on a guess would be worse than none.
 */
export function isAiRulesFixingNothing(
  counts: AiRuleFixCounts | null | undefined,
): boolean {
  if (!counts || !isCount(counts.enabled) || !isCount(counts.fixing)) {
    return false;
  }

  return counts.enabled > 0 && counts.fixing === 0;
}

// What the switch says, by the kind of lane it is on.
export enum AiRulesFixNothingLaneKind {
  // Incidents and alerts: nothing is fixed.
  Signal = "Signal",
  // A telemetry product's AI section: no pull request opens on its own.
  Telemetry = "Telemetry",
}

export const AI_RULES_FIX_NOTHING_COPY: Readonly<{
  sentence: Readonly<Record<AiRulesFixNothingLaneKind, string>>;
  link: string;
}> = {
  sentence: {
    [AiRulesFixNothingLaneKind.Signal]: translationKey(
      "Every AI rule says Don't fix, so nothing is fixed.",
    ),
    [AiRulesFixNothingLaneKind.Telemetry]: translationKey(
      "Every AI rule says Don't fix, so OneUptime AI opens no pull request on its own.",
    ),
  },
  link: translationKey("Review the AI rules"),
};

export const AI_RULES_FIX_NOTHING_TEST_IDS: Readonly<{
  warning: string;
  link: string;
}> = {
  warning: "ai-rules-fix-nothing",
  link: "ai-rules-fix-nothing-link",
};
