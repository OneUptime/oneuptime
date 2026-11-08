import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import {
  SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES,
  SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
  SLO_EVALUATION_CADENCE_MINUTES,
  isComparedWithCurrentBurnRate,
} from "../../../Utils/Slo/SloEvaluation";
import {
  SLO_FAST_BURN_RULE_NAME,
  SLO_SLOW_BURN_RULE_NAME,
  SLO_SLOW_LEAK_RULE_NAME,
  SloRecommendedBurnRateRule,
  getSloRecommendedBurnRateRules,
} from "../../../Utils/Slo/SloRecommendedBurnRateRules";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";

/*
 * The SLO cadence constants.
 *
 * These two numbers were prose before they were code — the worker owned them
 * and the dashboard described them in words ("evaluated every few minutes",
 * "1x spends the budget exactly over the window") without naming the lookback
 * the headline burn rate is measured over. Naming them once was the fix, and
 * each carries a claim about a number that lives somewhere else:
 *
 *   - the burn-rate window is "deliberately equal to the default fast-burn
 *     rule's long window, so the tile and that rule move together", and
 *   - the cadence is how often a due SLO is re-evaluated.
 *
 * Nothing makes either claim fail to compile. The seeded rules are
 * Common/Utils/Slo/SloRecommendedBurnRateRules, so someone retuning the
 * fast-burn default there would leave an overview tile silently measuring a
 * different span from the rule it is meant to agree with - the two would
 * disagree on screen with no error anywhere.
 */

// The rule a new 30-day SLO is seeded with, by name.
function seededRule(ruleName: string): SloRecommendedBurnRateRule {
  const rule: SloRecommendedBurnRateRule | undefined =
    getSloRecommendedBurnRateRules({
      windowType: SloWindowType.Rolling,
      windowDays: 30,
    }).find((candidate: SloRecommendedBurnRateRule): boolean => {
      return candidate.name === ruleName;
    });

  expect(rule).toBeDefined();

  return rule!;
}

describe("SLO evaluation cadence constants", () => {
  describe("the values themselves", () => {
    /*
     * Both are used as minutes and multiplied out to seconds by their
     * callers, so a zero would ask for a zero-length lookback and a
     * fractional value would land the query on a boundary no bucket starts
     * on.
     */
    test("both are positive whole numbers of minutes", () => {
      for (const value of [
        SLO_EVALUATION_CADENCE_MINUTES,
        SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
      ]) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    });

    /*
     * A burn rate measured over a span shorter than the gap between
     * evaluations would be recomputed from data the worker has not refreshed,
     * so the tile would repeat itself and call it a new reading.
     */
    test("the burn-rate lookback is at least one evaluation apart", () => {
      expect(SLO_CURRENT_BURN_RATE_WINDOW_MINUTES).toBeGreaterThanOrEqual(
        SLO_EVALUATION_CADENCE_MINUTES,
      );
    });
  });

  /*
   * The claim in the doc comment, checked against the thing it is a claim
   * about. If the fast-burn default is ever retuned, this fails here rather
   * than as two numbers quietly disagreeing on the SLO overview.
   */
  describe("the tile and the default fast-burn rule move together", () => {
    test("the burn-rate window equals the fast-burn rule's long window", () => {
      expect(seededRule(SLO_FAST_BURN_RULE_NAME).longWindowInMinutes).toBe(
        SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
      );
    });

    /*
     * The fast-burn short window is the tightest span the worker is ever
     * asked to answer for. Evaluating less often than that would leave it
     * reading a window that has already closed.
     */
    test("the evaluation cadence keeps up with the fast-burn short window", () => {
      expect(
        seededRule(SLO_FAST_BURN_RULE_NAME).shortWindowInMinutes,
      ).toBeGreaterThanOrEqual(SLO_EVALUATION_CADENCE_MINUTES);
    });

    /*
     * Slow burn is the deliberately longer pair. Pinned only as an ordering
     * against fast burn: if the two ever crossed over, the names would be
     * backwards and the rule an operator reaches for in an incident would be
     * the slower of the two.
     */
    test("slow burn is genuinely slower than fast burn, and slow leak slower still", () => {
      const fast: SloRecommendedBurnRateRule = seededRule(
        SLO_FAST_BURN_RULE_NAME,
      );
      const slow: SloRecommendedBurnRateRule = seededRule(
        SLO_SLOW_BURN_RULE_NAME,
      );
      const leak: SloRecommendedBurnRateRule = seededRule(
        SLO_SLOW_LEAK_RULE_NAME,
      );

      expect(slow.longWindowInMinutes).toBeGreaterThan(
        fast.longWindowInMinutes,
      );
      expect(slow.shortWindowInMinutes).toBeGreaterThan(
        fast.shortWindowInMinutes,
      );
      expect(leak.longWindowInMinutes).toBeGreaterThan(
        slow.longWindowInMinutes,
      );
      expect(leak.shortWindowInMinutes).toBeGreaterThan(
        slow.shortWindowInMinutes,
      );
    });
  });

  /*
   * The tile is an hour's reading. It is compared with the rules that look
   * back a few hours - the default Fast burn and Slow burn - and not with a
   * rule that looks back days, like Slow leak, which any hour that burned at
   * all would otherwise read as "at threshold".
   */
  describe("which rules the current burn rate is compared with", () => {
    test("the cut-off is the slow-burn rule's long window: six hours", () => {
      expect(SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES).toBe(360);
      expect(SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES).toBe(
        seededRule(SLO_SLOW_BURN_RULE_NAME).longWindowInMinutes,
      );
      expect(
        SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES,
      ).toBeGreaterThanOrEqual(SLO_CURRENT_BURN_RATE_WINDOW_MINUTES);
    });

    test("Fast burn and Slow burn are compared with it, Slow leak is not", () => {
      expect(
        isComparedWithCurrentBurnRate(
          seededRule(SLO_FAST_BURN_RULE_NAME).longWindowInMinutes,
        ),
      ).toBe(true);
      expect(
        isComparedWithCurrentBurnRate(
          seededRule(SLO_SLOW_BURN_RULE_NAME).longWindowInMinutes,
        ),
      ).toBe(true);
      expect(
        isComparedWithCurrentBurnRate(
          seededRule(SLO_SLOW_LEAK_RULE_NAME).longWindowInMinutes,
        ),
      ).toBe(false);
    });

    test("whatever the SLO's window, a slow leak of more than six hours is never compared", () => {
      for (const windowDays of [3, 7, 14, 28, 30, 90, 366]) {
        const leak: SloRecommendedBurnRateRule | undefined =
          getSloRecommendedBurnRateRules({
            windowType: SloWindowType.Rolling,
            windowDays: windowDays,
          }).find((rule: SloRecommendedBurnRateRule): boolean => {
            return rule.name === SLO_SLOW_LEAK_RULE_NAME;
          });

        expect(isComparedWithCurrentBurnRate(leak!.longWindowInMinutes)).toBe(
          false,
        );
      }
    });

    test.each([
      [5, true],
      [60, true],
      [359, true],
      [360, true],
      [361, false],
      [1440, false],
      [4320, false],
    ])(
      "a rule looking back %p minutes is compared: %p",
      (minutes: number, compared: boolean) => {
        expect(isComparedWithCurrentBurnRate(minutes)).toBe(compared);
      },
    );

    test("a rule whose long window is unknown is compared, as every rule was", () => {
      for (const minutes of [undefined, null, 0, -5, Number.NaN]) {
        expect(isComparedWithCurrentBurnRate(minutes)).toBe(true);
      }
    });
  });

  /*
   * Both constants exist so the worker and the UI read the same number. A
   * caller that inlined the value instead would drift the moment the constant
   * changed, which is the exact failure the constants were introduced to end.
   */
  describe("everything reads the shared constants rather than its own copy", () => {
    const WORKER_SOURCE: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      ),
      "utf8",
    );

    test("the evaluation worker imports both from here", () => {
      expect(WORKER_SOURCE).toContain("SLO_CURRENT_BURN_RATE_WINDOW_MINUTES");
      expect(WORKER_SOURCE).toContain("SLO_EVALUATION_CADENCE_MINUTES");
      expect(WORKER_SOURCE).toContain('from "Common/Utils/Slo/SloEvaluation"');
    });

    /*
     * The overview's burn rate tile moved out of Pages/Slo/View/Index.tsx into
     * the KPI strip component the page mounts; the budget runway beside it
     * names the same lookback through SloProjection.
     */
    test("the SLO overview's KPI strip reads the window from here too", () => {
      const kpiStrip: string = fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloKpiStrip.tsx",
        ),
        "utf8",
      );

      expect(kpiStrip).toMatch(
        /import \{[^}]*\bSLO_CURRENT_BURN_RATE_WINDOW_MINUTES\b[^}]*\} from "Common\/Utils\/Slo\/SloEvaluation"/,
      );
      expect(kpiStrip).toMatch(
        /import \{[^}]*\bSLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES\b[^}]*\} from "Common\/Utils\/Slo\/SloEvaluation"/,
      );
    });

    test("the budget runway projection names the same lookback", () => {
      const projection: string = fs.readFileSync(
        path.join(__dirname, "../../../Utils/Slo/SloProjection.ts"),
        "utf8",
      );

      expect(projection).toContain(
        'import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "./SloEvaluation"',
      );
    });
  });
});
