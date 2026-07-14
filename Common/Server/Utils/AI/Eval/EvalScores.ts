import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import AIConfidenceSignal from "../SRE/ConfidenceSignal";
import { GoldenCase, GoldenCaseConfidenceStats } from "./EvalCorpus";

/*
 * AI eval harness — scoring (G3 bootstrap). Pure: given a GoldenCase
 * corpus (EvalCorpus.ts), compute the four roadmap scores from recorded runs
 * and their labels — no LLM is re-run, no database is touched.
 *
 * HONESTY RULE (same as the fix-PR acceptance-rate work): every score is
 * {value, numerator, denominator} and value is NULL when the denominator is
 * zero. A score that cannot be measured reports "not measurable", never a
 * fake 0% or 100%.
 *
 * The two accuracy signals are deliberately NOT blended: autoGrade (the
 * on-resolve LLM comparison against Incident.rootCause) and humanVerdict (the
 * one-click panel judgment) measure different things with different biases —
 * report both, let the reader weigh them.
 */

export interface EvalScore {
  // numerator / denominator, or null when denominator is 0 (not measurable).
  value: number | null;
  numerator: number;
  denominator: number;
}

/*
 * Below this many labeled cases the numbers are noise, not measurement. The
 * runner must surface this loudly; nothing downstream (G3 graduation, public
 * scorecards) may consume a report whose sampleTooSmall is true.
 */
export const MINIMUM_TRUSTWORTHY_CORPUS_SIZE: number = 20;

export interface EvalScoreReport {
  caseCount: number;
  sampleTooSmall: boolean;
  /*
   * Of the auto-graded cases: fraction graded Match.
   * numerator = autoGrade === Match; denominator = autoGrade set (any value).
   */
  topHypothesisPrecision: EvalScore;
  /*
   * Of the human-labeled cases: fraction Confirmed. Reported separately from
   * topHypothesisPrecision — never blended.
   */
  humanConfirmedRate: EvalScore;
  /*
   * Of the cases whose analysis was posted: fraction with at least one
   * server-minted citation backing it.
   */
  citationGroundingRate: EvalScore;
  /*
   * Of ALL finished tool calls across the corpus (aggregated, not
   * mean-of-per-run-means — small runs must not dominate): fraction that
   * returned data.
   */
  toolSelectionAccuracy: EvalScore;
  /*
   * Of the human-REJECTED cases: fraction the deterministic evidence floor
   * (ConfidenceSignal) would have flagged inconclusive on its own — i.e. the
   * floor's recall of bad analyses, measured against human ground truth.
   */
  inconclusiveRecall: EvalScore;
}

export default class EvalScores {
  // Build a score with the null-when-unmeasurable rule applied.
  public static makeScore(numerator: number, denominator: number): EvalScore {
    return {
      value: denominator === 0 ? null : numerator / denominator,
      numerator,
      denominator,
    };
  }

  /*
   * Would the deterministic evidence floor have flagged this run inconclusive?
   * Reuses AIConfidenceSignal.hasVerifiableEvidence — the LIVE floor —
   * over the corpus stats, so the offline answer can never drift from what
   * production would actually have decided: zero citations minted AND zero
   * data-bearing tool calls.
   */
  public static wouldDeterministicFloorFlagInconclusive(
    confidence: GoldenCaseConfidenceStats,
  ): boolean {
    return !AIConfidenceSignal.hasVerifiableEvidence({
      citationCount: confidence.citationsMinted,
      dataBearingToolCallCount: confidence.dataBearingToolCalls,
      anyToolReturnedData: confidence.dataBearingToolCalls > 0,
    });
  }

  public static computeScores(cases: Array<GoldenCase>): EvalScoreReport {
    let gradedCount: number = 0;
    let gradedMatchCount: number = 0;

    let humanLabeledCount: number = 0;
    let humanConfirmedCount: number = 0;

    let analysisPostedCount: number = 0;
    let analysisPostedWithCitationCount: number = 0;

    let toolCallsTotal: number = 0;
    let dataBearingToolCalls: number = 0;

    let humanRejectedCount: number = 0;
    let humanRejectedFloorFlaggedCount: number = 0;

    for (const goldenCase of cases) {
      if (goldenCase.label.autoGrade) {
        gradedCount++;

        if (goldenCase.label.autoGrade === AIRunAutoGrade.Match) {
          gradedMatchCount++;
        }
      }

      if (goldenCase.label.humanVerdict) {
        humanLabeledCount++;

        if (goldenCase.label.humanVerdict === AIRunHumanVerdict.Confirmed) {
          humanConfirmedCount++;
        }

        if (goldenCase.label.humanVerdict === AIRunHumanVerdict.Rejected) {
          humanRejectedCount++;

          if (
            this.wouldDeterministicFloorFlagInconclusive(goldenCase.confidence)
          ) {
            humanRejectedFloorFlaggedCount++;
          }
        }
      }

      if (goldenCase.analysisPosted) {
        analysisPostedCount++;

        if (goldenCase.confidence.citationsMinted > 0) {
          analysisPostedWithCitationCount++;
        }
      }

      toolCallsTotal += goldenCase.confidence.toolCallsTotal;
      dataBearingToolCalls += goldenCase.confidence.dataBearingToolCalls;
    }

    return {
      caseCount: cases.length,
      sampleTooSmall: cases.length < MINIMUM_TRUSTWORTHY_CORPUS_SIZE,
      topHypothesisPrecision: this.makeScore(gradedMatchCount, gradedCount),
      humanConfirmedRate: this.makeScore(
        humanConfirmedCount,
        humanLabeledCount,
      ),
      citationGroundingRate: this.makeScore(
        analysisPostedWithCitationCount,
        analysisPostedCount,
      ),
      toolSelectionAccuracy: this.makeScore(
        dataBearingToolCalls,
        toolCallsTotal,
      ),
      inconclusiveRecall: this.makeScore(
        humanRejectedFloorFlaggedCount,
        humanRejectedCount,
      ),
    };
  }
}
