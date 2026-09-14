import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import {
  SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
  SLO_EVALUATION_CADENCE_MINUTES,
} from "../../../Utils/Slo/SloEvaluation";

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
 * Nothing makes either claim fail to compile. The seeded rules are written by
 * ServiceLevelObjectiveService as plain literals, so someone retuning the
 * fast-burn default there would leave an overview tile silently measuring a
 * different span from the rule it is meant to agree with — the two would
 * disagree on screen with no error anywhere.
 *
 * The defaults are read as text because seeding them is a database write
 * behind a full SLO create, which is not what is under test here.
 */

const SLO_SERVICE_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "../../../Server/Services/ServiceLevelObjectiveService.ts",
  ),
  "utf8",
);

/*
 * The literal block for one seeded rule, so "Fast burn" and "Slow burn"
 * cannot be confused for one another — they differ only in their numbers.
 */
function seededRuleBlock(ruleName: string): string {
  const start: number = SLO_SERVICE_SOURCE.indexOf(`name: "${ruleName}"`);

  expect(start).toBeGreaterThan(-1);

  const end: number = SLO_SERVICE_SOURCE.indexOf("}", start);
  expect(end).toBeGreaterThan(start);

  return SLO_SERVICE_SOURCE.slice(start, end);
}

function minutesFieldIn(block: string, field: string): number {
  const match: RegExpMatchArray | null = block.match(
    new RegExp(`${field}:\\s*(\\d+)`),
  );

  expect(match).not.toBeNull();

  return Number(match![1]);
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
      expect(
        minutesFieldIn(seededRuleBlock("Fast burn"), "longWindowInMinutes"),
      ).toBe(SLO_CURRENT_BURN_RATE_WINDOW_MINUTES);
    });

    /*
     * The fast-burn short window is the tightest span the worker is ever
     * asked to answer for. Evaluating less often than that would leave it
     * reading a window that has already closed.
     */
    test("the evaluation cadence keeps up with the fast-burn short window", () => {
      expect(
        minutesFieldIn(seededRuleBlock("Fast burn"), "shortWindowInMinutes"),
      ).toBeGreaterThanOrEqual(SLO_EVALUATION_CADENCE_MINUTES);
    });

    /*
     * Slow burn is the deliberately longer pair. Pinned only as an ordering
     * against fast burn: if the two ever crossed over, the names would be
     * backwards and the rule an operator reaches for in an incident would be
     * the slower of the two.
     */
    test("slow burn is genuinely slower than fast burn", () => {
      const fast: string = seededRuleBlock("Fast burn");
      const slow: string = seededRuleBlock("Slow burn");

      expect(minutesFieldIn(slow, "longWindowInMinutes")).toBeGreaterThan(
        minutesFieldIn(fast, "longWindowInMinutes"),
      );
      expect(minutesFieldIn(slow, "shortWindowInMinutes")).toBeGreaterThan(
        minutesFieldIn(fast, "shortWindowInMinutes"),
      );
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

    test("the SLO overview reads the window from here too", () => {
      const overview: string = fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Index.tsx",
        ),
        "utf8",
      );

      expect(overview).toContain(
        'import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "Common/Utils/Slo/SloEvaluation"',
      );
    });
  });
});
