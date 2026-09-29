import EvalScores, {
  EvalScoreReport,
  MINIMUM_TRUSTWORTHY_CORPUS_SIZE,
} from "../../../../Server/Utils/AI/Eval/EvalScores";
import {
  GoldenCase,
  GoldenCaseConfidenceStats,
} from "../../../../Server/Utils/AI/Eval/EvalCorpus";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import { describe, expect, test } from "@jest/globals";

/*
 * The G3 eval scores, computed purely from recorded labeled runs. Under test:
 * each score's exact numerator/denominator definition, the honesty rule
 * (value is NULL when the denominator is 0 — never a fake 0% or 100%), the
 * no-blending rule (autoGrade precision vs human confirmed rate stay
 * separate), aggregation semantics for tool selection, and the small-sample
 * flag.
 */

function stats(
  data: Partial<GoldenCaseConfidenceStats>,
): GoldenCaseConfidenceStats {
  return {
    citationsMinted: 0,
    dataBearingToolCalls: 0,
    toolCallsTotal: 0,
    toolCallsFailed: 0,
    ...data,
  };
}

function goldenCase(data: {
  humanVerdict?: AIRunHumanVerdict | undefined;
  autoGrade?: AIRunAutoGrade | undefined;
  analysisPosted?: boolean | undefined;
  confidence?: Partial<GoldenCaseConfidenceStats> | undefined;
}): GoldenCase {
  return {
    runId: "run",
    projectId: "project",
    subjectType: "Incident",
    completedAt: "2026-07-13T00:00:00.000Z",
    label: {
      humanVerdict: data.humanVerdict,
      autoGrade: data.autoGrade,
    },
    confidence: stats(data.confidence || {}),
    analysisPosted: data.analysisPosted ?? true,
    events: [],
  };
}

describe("EvalScores.makeScore (the honesty rule)", () => {
  test("a zero denominator yields value null — never a fake 0 or 100", () => {
    expect(EvalScores.makeScore(0, 0)).toEqual({
      value: null,
      numerator: 0,
      denominator: 0,
    });
  });

  test("a measurable score carries its exact fraction and both counts", () => {
    expect(EvalScores.makeScore(2, 3)).toEqual({
      value: 2 / 3,
      numerator: 2,
      denominator: 3,
    });
    expect(EvalScores.makeScore(0, 5)).toEqual({
      value: 0,
      numerator: 0,
      denominator: 5,
    });
  });
});

describe("EvalScores.wouldDeterministicFloorFlagInconclusive", () => {
  test("zero citations AND zero data-bearing calls → flagged (the floor's exact rule)", () => {
    expect(EvalScores.wouldDeterministicFloorFlagInconclusive(stats({}))).toBe(
      true,
    );
    expect(
      EvalScores.wouldDeterministicFloorFlagInconclusive(
        stats({ toolCallsTotal: 4, toolCallsFailed: 4 }),
      ),
    ).toBe(true);
  });

  test("a single minted citation clears the floor (rowCount 0 is proof of absence — still evidence)", () => {
    expect(
      EvalScores.wouldDeterministicFloorFlagInconclusive(
        stats({ citationsMinted: 1 }),
      ),
    ).toBe(false);
  });

  test("a data-bearing tool call clears the floor even with zero citations", () => {
    expect(
      EvalScores.wouldDeterministicFloorFlagInconclusive(
        stats({ dataBearingToolCalls: 1, toolCallsTotal: 1 }),
      ),
    ).toBe(false);
  });
});

describe("EvalScores.computeScores — empty corpus", () => {
  test("every score is null-valued with 0/0, and the sample is too small", () => {
    const report: EvalScoreReport = EvalScores.computeScores([]);

    expect(report.caseCount).toBe(0);
    expect(report.sampleTooSmall).toBe(true);

    for (const score of [
      report.topHypothesisPrecision,
      report.humanConfirmedRate,
      report.citationGroundingRate,
      report.toolSelectionAccuracy,
      report.inconclusiveRecall,
    ]) {
      expect(score).toEqual({ value: null, numerator: 0, denominator: 0 });
    }
  });
});

describe("EvalScores.computeScores — topHypothesisPrecision (autoGrade only)", () => {
  test("Match / (Match+Partial+Mismatch); ungraded cases are excluded from the denominator", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      goldenCase({ autoGrade: AIRunAutoGrade.Match }),
      goldenCase({ autoGrade: AIRunAutoGrade.Partial }),
      goldenCase({ autoGrade: AIRunAutoGrade.Mismatch }),
      goldenCase({ autoGrade: AIRunAutoGrade.Match }),
      // Human-labeled but ungraded: must not appear in this denominator.
      goldenCase({ humanVerdict: AIRunHumanVerdict.Confirmed }),
    ]);

    expect(report.topHypothesisPrecision).toEqual({
      value: 2 / 4,
      numerator: 2,
      denominator: 4,
    });
  });

  test("Partial does NOT count as a match", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      goldenCase({ autoGrade: AIRunAutoGrade.Partial }),
    ]);

    expect(report.topHypothesisPrecision).toEqual({
      value: 0,
      numerator: 0,
      denominator: 1,
    });
  });

  test("no graded cases → null, even when human labels exist (no blending)", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      goldenCase({ humanVerdict: AIRunHumanVerdict.Confirmed }),
      goldenCase({ humanVerdict: AIRunHumanVerdict.Rejected }),
    ]);

    expect(report.topHypothesisPrecision.value).toBeNull();
    expect(report.topHypothesisPrecision.denominator).toBe(0);
  });
});

describe("EvalScores.computeScores — humanConfirmedRate (humanVerdict only)", () => {
  test("Confirmed / (Confirmed+Rejected); auto-graded-only cases are excluded", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      goldenCase({ humanVerdict: AIRunHumanVerdict.Confirmed }),
      goldenCase({ humanVerdict: AIRunHumanVerdict.Confirmed }),
      goldenCase({ humanVerdict: AIRunHumanVerdict.Rejected }),
      // Graded but no human verdict: not in this denominator.
      goldenCase({ autoGrade: AIRunAutoGrade.Match }),
    ]);

    expect(report.humanConfirmedRate).toEqual({
      value: 2 / 3,
      numerator: 2,
      denominator: 3,
    });
  });

  test("a case carrying BOTH labels counts once in each score, blended in neither", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      goldenCase({
        humanVerdict: AIRunHumanVerdict.Rejected,
        autoGrade: AIRunAutoGrade.Match,
      }),
    ]);

    // The human said Rejected — the auto Match must not leak into this rate.
    expect(report.humanConfirmedRate).toEqual({
      value: 0,
      numerator: 0,
      denominator: 1,
    });
    // And the rejection must not drag the graded precision down.
    expect(report.topHypothesisPrecision).toEqual({
      value: 1,
      numerator: 1,
      denominator: 1,
    });
  });
});

describe("EvalScores.computeScores — citationGroundingRate", () => {
  test("cases with >=1 minted citation among cases whose analysis was posted", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      goldenCase({
        autoGrade: AIRunAutoGrade.Match,
        analysisPosted: true,
        confidence: { citationsMinted: 3 },
      }),
      goldenCase({
        autoGrade: AIRunAutoGrade.Mismatch,
        analysisPosted: true,
        confidence: { citationsMinted: 0 },
      }),
      // Not posted: excluded from the denominator even though it has citations.
      goldenCase({
        humanVerdict: AIRunHumanVerdict.Rejected,
        analysisPosted: false,
        confidence: { citationsMinted: 2 },
      }),
    ]);

    expect(report.citationGroundingRate).toEqual({
      value: 1 / 2,
      numerator: 1,
      denominator: 2,
    });
  });

  test("no posted analyses at all → null, not 0%", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      goldenCase({
        humanVerdict: AIRunHumanVerdict.Rejected,
        analysisPosted: false,
      }),
    ]);

    expect(report.citationGroundingRate.value).toBeNull();
  });
});

describe("EvalScores.computeScores — toolSelectionAccuracy", () => {
  test("aggregated across the corpus: sum of data-bearing / sum of finished calls (NOT a mean of per-run rates)", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      // 1/1 data-bearing.
      goldenCase({
        autoGrade: AIRunAutoGrade.Match,
        confidence: { dataBearingToolCalls: 1, toolCallsTotal: 1 },
      }),
      // 1/9 data-bearing.
      goldenCase({
        autoGrade: AIRunAutoGrade.Mismatch,
        confidence: {
          dataBearingToolCalls: 1,
          toolCallsTotal: 9,
          toolCallsFailed: 3,
        },
      }),
    ]);

    /*
     * Aggregated: (1+1)/(1+9) = 20%. A mean of per-run rates would say
     * (100% + 11.1%)/2 ≈ 55.6% — the tiny run must not dominate.
     */
    expect(report.toolSelectionAccuracy).toEqual({
      value: 2 / 10,
      numerator: 2,
      denominator: 10,
    });
  });

  test("a corpus whose runs made no tool calls → null", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      goldenCase({ autoGrade: AIRunAutoGrade.Match }),
    ]);

    expect(report.toolSelectionAccuracy.value).toBeNull();
  });
});

describe("EvalScores.computeScores — inconclusiveRecall", () => {
  test("among human-Rejected cases: fraction the deterministic floor would have flagged", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      // Rejected + zero evidence → the floor would have caught it.
      goldenCase({
        humanVerdict: AIRunHumanVerdict.Rejected,
        confidence: { citationsMinted: 0, dataBearingToolCalls: 0 },
      }),
      // Rejected but evidence existed → the floor would NOT have caught it.
      goldenCase({
        humanVerdict: AIRunHumanVerdict.Rejected,
        confidence: { citationsMinted: 2, dataBearingToolCalls: 1 },
      }),
      // Confirmed cases are not in this denominator at all.
      goldenCase({
        humanVerdict: AIRunHumanVerdict.Confirmed,
        confidence: { citationsMinted: 0 },
      }),
    ]);

    expect(report.inconclusiveRecall).toEqual({
      value: 1 / 2,
      numerator: 1,
      denominator: 2,
    });
  });

  test("no human-Rejected cases → null (a corpus of confirmations cannot measure recall)", () => {
    const report: EvalScoreReport = EvalScores.computeScores([
      goldenCase({ humanVerdict: AIRunHumanVerdict.Confirmed }),
      goldenCase({ autoGrade: AIRunAutoGrade.Mismatch }),
    ]);

    expect(report.inconclusiveRecall.value).toBeNull();
  });
});

describe("EvalScores.computeScores — the small-sample flag", () => {
  test("below the minimum the report says so; at the minimum it does not", () => {
    const smallCorpus: Array<GoldenCase> = Array.from(
      { length: MINIMUM_TRUSTWORTHY_CORPUS_SIZE - 1 },
      () => {
        return goldenCase({ autoGrade: AIRunAutoGrade.Match });
      },
    );

    expect(EvalScores.computeScores(smallCorpus).sampleTooSmall).toBe(true);

    const justEnough: Array<GoldenCase> = Array.from(
      { length: MINIMUM_TRUSTWORTHY_CORPUS_SIZE },
      () => {
        return goldenCase({ autoGrade: AIRunAutoGrade.Match });
      },
    );

    expect(EvalScores.computeScores(justEnough).sampleTooSmall).toBe(false);
  });
});
