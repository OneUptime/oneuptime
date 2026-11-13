import ObjectID from "../../../../Types/ObjectID";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import { AIRunStopReason } from "../../../../Types/AI/AIAgentRunLimits";
import { InvestigationRecording } from "../../../../Types/AI/InvestigationRecording";
import EvalJudge from "./EvalJudge";
import { PinnedModelCall } from "./PinnedModel";
import { RecordedToolAnswerCounts } from "./RecordedToolAnswers";
import { ReplayCase } from "./ReplayCorpus";
import ReplayInvestigation, { ReplayResult } from "./ReplayInvestigation";

/*
 * Runs recorded investigations again with the model (and prompt) under test
 * and grades both - the analysis the original run posted and the replay's -
 * with one judge against the root cause people wrote (issue #6800). What
 * `npm run ai-eval -- --replay` prints and writes comes from here.
 *
 * The runs are read through a ReplayCaseSource (ReplayCorpus, from the
 * database) and taken one at a time: each costs model calls, and a failure
 * is that case's, never the whole run's.
 */

export interface ReplayCaseSource {
  getRecording(replayCase: ReplayCase): Promise<InvestigationRecording | null>;
  getOriginalAnalysis(replayCase: ReplayCase): Promise<string | null>;
}

export enum ReplaySkipReason {
  NoRecording = "No recording kept for this run",
  NoRootCause = "No root cause written for the incident or alert yet",
}

export interface ReplayCaseResult {
  runId: string;
  projectId: string;
  subjectType: ReplayCase["subjectType"];
  subjectId: string;
  rootCause: string | null;
  original: {
    // As graded when the incident resolved, by the project's own model.
    autoGrade?: AIRunAutoGrade | undefined;
    humanVerdict?: AIRunHumanVerdict | undefined;
    // Graded again now by this eval's judge, beside the replay.
    judgeGrade?: AIRunAutoGrade | null | undefined;
    hasAnalysis: boolean;
    llmCallCount?: number | undefined;
    toolCallCount?: number | undefined;
    totalTokens?: number | undefined;
  };
  replay?:
    | {
        analysisMarkdown: string;
        judgeGrade: AIRunAutoGrade | null;
        llmCallCount: number;
        toolCallCount: number;
        totalTokens: number;
        answers: RecordedToolAnswerCounts;
        stopReason?: AIRunStopReason | undefined;
        providerName?: string | undefined;
        modelName?: string | undefined;
      }
    | undefined;
  // Why the case was not replayed.
  skipped?: ReplaySkipReason | undefined;
  // What went wrong with it, when something did.
  error?: string | undefined;
}

export interface ReplayGradeCounts {
  match: number;
  partial: number;
  mismatch: number;
}

export interface ReplaySummary {
  caseCount: number;
  replayedCount: number;
  skippedCount: number;
  erroredCount: number;
  // Cases whose original and replay the judge both graded: the ones compared.
  comparedCount: number;
  original: ReplayGradeCounts;
  replay: ReplayGradeCounts;
  improvedCount: number;
  unchangedCount: number;
  worsenedCount: number;
  answers: RecordedToolAnswerCounts;
  originalTokens: number;
  replayTokens: number;
}

// How good a grade is, to tell a replay that did better from one that did worse.
export function getGradeRank(grade: AIRunAutoGrade): number {
  switch (grade) {
    case AIRunAutoGrade.Match:
      return 2;
    case AIRunAutoGrade.Partial:
      return 1;
    default:
      return 0;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default class ReplayRunner {
  public static async runCase(data: {
    replayCase: ReplayCase;
    source: ReplayCaseSource;
    callModel: PinnedModelCall;
    // Grades both analyses; the model under test when left out.
    judge?: PinnedModelCall | undefined;
    persona?: string | undefined;
  }): Promise<ReplayCaseResult> {
    const { replayCase } = data;
    const judge: PinnedModelCall = data.judge || data.callModel;

    const result: ReplayCaseResult = {
      runId: replayCase.runId,
      projectId: replayCase.projectId,
      subjectType: replayCase.subjectType,
      subjectId: replayCase.subjectId,
      rootCause: replayCase.rootCause,
      original: {
        autoGrade: replayCase.original.autoGrade,
        humanVerdict: replayCase.original.humanVerdict,
        hasAnalysis: false,
        llmCallCount: replayCase.original.llmCallCount,
        toolCallCount: replayCase.original.toolCallCount,
        totalTokens: replayCase.original.totalTokens,
      },
    };

    let recording: InvestigationRecording | null;

    try {
      recording = await data.source.getRecording(replayCase);
    } catch (error) {
      return { ...result, error: describeError(error) };
    }

    if (!recording) {
      return { ...result, skipped: ReplaySkipReason.NoRecording };
    }

    /*
     * With no root cause written yet there is nothing to grade against: the
     * replay would spend model calls for a result nobody can score.
     */
    if (!replayCase.rootCause) {
      return { ...result, skipped: ReplaySkipReason.NoRootCause };
    }

    const rootCause: string = replayCase.rootCause;
    const errors: Array<string> = [];

    try {
      const originalAnalysis: string | null =
        await data.source.getOriginalAnalysis(replayCase);

      result.original.hasAnalysis = Boolean(originalAnalysis);

      if (originalAnalysis) {
        result.original.judgeGrade = await EvalJudge.grade({
          rootCause,
          analysisMarkdown: originalAnalysis,
          callModel: judge,
        });
      }
    } catch (error) {
      result.original.judgeGrade = null;
      errors.push(
        `The original analysis could not be graded: ${describeError(error)}`,
      );
    }

    let replay: ReplayResult;

    try {
      replay = await ReplayInvestigation.replay({
        projectId: new ObjectID(replayCase.projectId),
        recording,
        callModel: data.callModel,
        persona: data.persona,
      });
    } catch (error) {
      errors.push(`The replay failed: ${describeError(error)}`);
      return { ...result, error: errors.join(" ") };
    }

    let replayGrade: AIRunAutoGrade | null = null;

    try {
      replayGrade = await EvalJudge.grade({
        rootCause,
        analysisMarkdown: replay.analysisMarkdown,
        callModel: judge,
      });
    } catch (error) {
      errors.push(`The replay could not be graded: ${describeError(error)}`);
    }

    result.replay = {
      analysisMarkdown: replay.analysisMarkdown,
      judgeGrade: replayGrade,
      llmCallCount: replay.llmCallCount,
      toolCallCount: replay.toolCallCount,
      totalTokens: replay.totalTokens,
      answers: replay.answers,
      ...(replay.stopReason ? { stopReason: replay.stopReason } : {}),
      ...(replay.providerName ? { providerName: replay.providerName } : {}),
      ...(replay.modelName ? { modelName: replay.modelName } : {}),
    };

    if (errors.length > 0) {
      result.error = errors.join(" ");
    }

    return result;
  }

  public static async run(data: {
    cases: Array<ReplayCase>;
    source: ReplayCaseSource;
    callModel: PinnedModelCall;
    judge?: PinnedModelCall | undefined;
    persona?: string | undefined;
    // Told as each case finishes, for a progress line.
    onCase?:
      | ((result: ReplayCaseResult, index: number, count: number) => void)
      | undefined;
  }): Promise<Array<ReplayCaseResult>> {
    const results: Array<ReplayCaseResult> = [];

    for (const replayCase of data.cases) {
      const result: ReplayCaseResult = await this.runCase({
        replayCase,
        source: data.source,
        callModel: data.callModel,
        judge: data.judge,
        persona: data.persona,
      });

      results.push(result);

      if (data.onCase) {
        data.onCase(result, results.length - 1, data.cases.length);
      }
    }

    return results;
  }

  public static summarize(results: Array<ReplayCaseResult>): ReplaySummary {
    const summary: ReplaySummary = {
      caseCount: results.length,
      replayedCount: 0,
      skippedCount: 0,
      erroredCount: 0,
      comparedCount: 0,
      original: { match: 0, partial: 0, mismatch: 0 },
      replay: { match: 0, partial: 0, mismatch: 0 },
      improvedCount: 0,
      unchangedCount: 0,
      worsenedCount: 0,
      answers: { exact: 0, nearbyTime: 0, notRecorded: 0 },
      originalTokens: 0,
      replayTokens: 0,
    };

    const count: (counts: ReplayGradeCounts, grade: AIRunAutoGrade) => void = (
      counts: ReplayGradeCounts,
      grade: AIRunAutoGrade,
    ): void => {
      if (grade === AIRunAutoGrade.Match) {
        counts.match++;
      } else if (grade === AIRunAutoGrade.Partial) {
        counts.partial++;
      } else {
        counts.mismatch++;
      }
    };

    for (const result of results) {
      if (result.skipped) {
        summary.skippedCount++;
        continue;
      }

      if (result.error) {
        summary.erroredCount++;
      }

      if (!result.replay) {
        continue;
      }

      summary.replayedCount++;
      summary.replayTokens += result.replay.totalTokens;
      summary.originalTokens += result.original.totalTokens || 0;
      summary.answers.exact += result.replay.answers.exact;
      summary.answers.nearbyTime += result.replay.answers.nearbyTime;
      summary.answers.notRecorded += result.replay.answers.notRecorded;

      const originalGrade: AIRunAutoGrade | null | undefined =
        result.original.judgeGrade;
      const replayGrade: AIRunAutoGrade | null = result.replay.judgeGrade;

      // Compared only where both were graded: the two columns count the same cases.
      if (!originalGrade || !replayGrade) {
        continue;
      }

      summary.comparedCount++;
      count(summary.original, originalGrade);
      count(summary.replay, replayGrade);

      const change: number =
        getGradeRank(replayGrade) - getGradeRank(originalGrade);

      if (change > 0) {
        summary.improvedCount++;
      } else if (change < 0) {
        summary.worsenedCount++;
      } else {
        summary.unchangedCount++;
      }
    }

    return summary;
  }
}
