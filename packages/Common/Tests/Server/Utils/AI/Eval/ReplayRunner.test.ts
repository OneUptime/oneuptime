import ReplayRunner, {
  ReplayCaseResult,
  ReplayCaseSource,
  ReplaySkipReason,
  ReplaySummary,
  getGradeRank,
} from "../../../../../Server/Utils/AI/Eval/ReplayRunner";
import ReplayInvestigation, {
  ReplayRequest,
  ReplayResult,
} from "../../../../../Server/Utils/AI/Eval/ReplayInvestigation";
import { ReplayCase } from "../../../../../Server/Utils/AI/Eval/ReplayCorpus";
import { PinnedModelCall } from "../../../../../Server/Utils/AI/Eval/PinnedModel";
import {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
} from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { GRADING_MAX_TOKENS } from "../../../../../Server/Utils/AI/SRE/InvestigationGrader";
import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import AIService from "../../../../../Server/Services/AIService";
import AIAgentRunLimitsHelper, {
  AIRunStopReason,
} from "../../../../../Types/AI/AIAgentRunLimits";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import {
  INVESTIGATION_RECORDING_VERSION,
  InvestigationRecording,
} from "../../../../../Types/AI/InvestigationRecording";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * RUNNING RECORDED INVESTIGATIONS AGAIN, AND GRADING BOTH (issue #6800):
 * each case's recording is replayed with the model under test, and one
 * judge grades the analysis the original run posted and the replay's
 * against the root cause people wrote. What `npm run ai-eval -- --replay`
 * prints and writes comes from here.
 *
 * Under test: a case skipped before any model call when it has no
 * recording or no root cause; the same judge for both grades (the model
 * under test when none is named); each failure kept to its case - a
 * recording that cannot be read, an original that cannot be graded, a
 * replay that fails, a replay that cannot be graded; the cases taken one
 * at a time, in order, told as each finishes; and the summary's counts:
 * compared only where both were graded, better, same or worse.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ROOT_CAUSE: string = "The checkout pool was cut from 40 to 10.";
const ORIGINAL_ANALYSIS: string = "ORIGINAL: the database was slow [C1].";
const REPLAY_ANALYSIS: string = "REPLAY: the pool was cut from 40 to 10 [C1].";

function replayCase(
  runId: string,
  overrides: Partial<ReplayCase> = {},
): ReplayCase {
  return {
    runId,
    projectId: PROJECT_ID,
    subjectType: "Incident",
    subjectId: "22222222-2222-4222-8222-222222222222",
    completedAt: "2026-11-10T08:41:12.000Z",
    rootCause: ROOT_CAUSE,
    original: {
      autoGrade: AIRunAutoGrade.Mismatch,
      humanVerdict: AIRunHumanVerdict.Rejected,
      llmCallCount: 9,
      toolCallCount: 14,
      totalTokens: 52_000,
    },
    ...overrides,
  };
}

function recording(): InvestigationRecording {
  return {
    version: INVESTIGATION_RECORDING_VERSION,
    inputs: {
      contextText: "# Incident\nTitle: Checkout returns 500s",
      aiContext: null,
      promptTime: "2026-11-10T08:30:00.000Z",
      runLimits: AIAgentRunLimitsHelper.getDefault(),
      maxOutputTokens: 4096,
      excludedToolNames: ["get_ai_investigation", "start_investigation"],
      extraTools: [],
    },
    toolCalls: [
      {
        toolName: "search_logs",
        arguments: { query: "checkout" },
        success: true,
        text: "3 rows: pool exhausted",
        rowCount: 3,
        citationLabel: "Logs",
      },
    ],
    toolCallsNotKept: 0,
  };
}

interface FakeSource extends ReplayCaseSource {
  recordingReads: Array<string>;
  analysisReads: Array<string>;
}

function source(
  data: {
    recording?: InvestigationRecording | null | Error;
    analysis?: string | null | Error;
  } = {},
): FakeSource {
  const recordingReads: Array<string> = [];
  const analysisReads: Array<string> = [];

  return {
    recordingReads,
    analysisReads,
    getRecording: async (
      fromCase: ReplayCase,
    ): Promise<InvestigationRecording | null> => {
      recordingReads.push(fromCase.runId);

      if (data.recording instanceof Error) {
        throw data.recording;
      }

      return data.recording === undefined ? recording() : data.recording;
    },
    getOriginalAnalysis: async (
      fromCase: ReplayCase,
    ): Promise<string | null> => {
      analysisReads.push(fromCase.runId);

      if (data.analysis instanceof Error) {
        throw data.analysis;
      }

      return data.analysis === undefined ? ORIGINAL_ANALYSIS : data.analysis;
    },
  };
}

interface FakeModel {
  callModel: PinnedModelCall;
  calls: Array<ObservabilityAssistantModelCall>;
}

/*
 * A judge that grades the original PARTIAL and the replay MATCH (or what
 * it is told to), by the analysis it is shown.
 */
function judge(grades: { original?: string; replay?: string } = {}): FakeModel {
  const calls: Array<ObservabilityAssistantModelCall> = [];

  return {
    calls,
    callModel: async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      calls.push(call);

      const shown: string = call.messages[call.messages.length - 1]!.content;
      const content: string = shown.includes("ORIGINAL:")
        ? grades.original ?? "PARTIAL"
        : grades.replay ?? "MATCH";

      if (content === "THROW") {
        throw new Error("judge is down");
      }

      return { content, tokenCount: 10 };
    },
  };
}

// The model under test, which a test replaces the replay of.
function modelUnderTest(): FakeModel {
  const calls: Array<ObservabilityAssistantModelCall> = [];

  return {
    calls,
    callModel: async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      calls.push(call);
      return { content: "MATCH", tokenCount: 10 };
    },
  };
}

function replayResult(overrides: Partial<ReplayResult> = {}): ReplayResult {
  return {
    analysisMarkdown: REPLAY_ANALYSIS,
    citations: [],
    llmCallCount: 4,
    toolCallCount: 6,
    totalTokens: 21_000,
    answers: { exact: 5, nearbyTime: 1, notRecorded: 0 },
    unrecordedToolCallCount: 0,
    ...overrides,
  };
}

function mockReplay(
  result: ReplayResult | Error = replayResult(),
): SpyInstance<typeof ReplayInvestigation.replay> {
  const spy: SpyInstance<typeof ReplayInvestigation.replay> = jest.spyOn(
    ReplayInvestigation,
    "replay",
  );

  if (result instanceof Error) {
    spy.mockRejectedValue(result);
  } else {
    spy.mockResolvedValue(result);
  }

  return spy;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getGradeRank", () => {
  test("a match is better than a partial, which is better than a mismatch", () => {
    expect(getGradeRank(AIRunAutoGrade.Match)).toBe(2);
    expect(getGradeRank(AIRunAutoGrade.Partial)).toBe(1);
    expect(getGradeRank(AIRunAutoGrade.Mismatch)).toBe(0);
  });
});

describe("ReplayRunner.runCase: what is skipped, before any model call", () => {
  test("a run that kept no recording is skipped, and nothing else is read", async () => {
    const replay: SpyInstance<typeof ReplayInvestigation.replay> = mockReplay();
    const model: FakeModel = modelUnderTest();
    const cases: FakeSource = source({ recording: null });

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: cases,
      callModel: model.callModel,
    });

    expect(result.skipped).toBe(ReplaySkipReason.NoRecording);
    expect(ReplaySkipReason.NoRecording).toBe("No recording kept for this run");
    expect(result.replay).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(cases.analysisReads).toEqual([]);
    expect(replay).not.toHaveBeenCalled();
    expect(model.calls).toHaveLength(0);
  });

  test("a run with no root cause written yet is skipped: nothing to grade against, so no model is paid", async () => {
    const replay: SpyInstance<typeof ReplayInvestigation.replay> = mockReplay();
    const model: FakeModel = modelUnderTest();
    const grader: FakeModel = judge();

    for (const rootCause of [null, ""]) {
      const result: ReplayCaseResult = await ReplayRunner.runCase({
        replayCase: replayCase("run-1", { rootCause }),
        source: source(),
        callModel: model.callModel,
        judge: grader.callModel,
      });

      expect(result.skipped).toBe(ReplaySkipReason.NoRootCause);
      expect(result.original.hasAnalysis).toBe(false);
    }

    expect(ReplaySkipReason.NoRootCause).toBe(
      "No root cause written for the incident or alert yet",
    );
    expect(replay).not.toHaveBeenCalled();
    expect(model.calls).toHaveLength(0);
    expect(grader.calls).toHaveLength(0);
  });

  test("a recording that cannot be read is that case's error, not a skip and not a throw", async () => {
    const replay: SpyInstance<typeof ReplayInvestigation.replay> = mockReplay();

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source({ recording: new Error("connection refused") }),
      callModel: modelUnderTest().callModel,
    });

    expect(result.error).toBe("connection refused");
    expect(result.skipped).toBeUndefined();
    expect(replay).not.toHaveBeenCalled();
  });
});

describe("ReplayRunner.runCase: one judge for both grades", () => {
  test("grades the original analysis and the replay's with the same judge, against the case's root cause", async () => {
    mockReplay();
    const grader: FakeModel = judge();
    const model: FakeModel = modelUnderTest();

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source(),
      callModel: model.callModel,
      judge: grader.callModel,
    });

    expect(grader.calls).toHaveLength(2);
    // The model under test graded nothing: a judge was named.
    expect(model.calls).toHaveLength(0);

    const [first, second] = grader.calls;

    for (const call of [first!, second!]) {
      expect(call.maxTokens).toBe(GRADING_MAX_TOKENS);
      expect(call.temperature).toBe(0);
      expect(call.tools).toBeUndefined();
      expect(call.messages[1]!.content).toContain(ROOT_CAUSE);
    }

    expect(first!.messages[1]!.content).toContain(ORIGINAL_ANALYSIS);
    expect(second!.messages[1]!.content).toContain(REPLAY_ANALYSIS);

    expect(result.original.judgeGrade).toBe(AIRunAutoGrade.Partial);
    expect(result.replay!.judgeGrade).toBe(AIRunAutoGrade.Match);
    expect(result.error).toBeUndefined();
  });

  test("with no judge named, the model under test grades both", async () => {
    mockReplay();
    const model: FakeModel = modelUnderTest();

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source(),
      callModel: model.callModel,
    });

    expect(model.calls).toHaveLength(2);
    expect(result.original.judgeGrade).toBe(AIRunAutoGrade.Match);
    expect(result.replay!.judgeGrade).toBe(AIRunAutoGrade.Match);
  });

  test("replays the case's recording, in its project, with the model under test and the draft persona", async () => {
    const replay: SpyInstance<typeof ReplayInvestigation.replay> = mockReplay();
    const model: FakeModel = modelUnderTest();
    const kept: InvestigationRecording = recording();

    await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: {
        getRecording: async (): Promise<InvestigationRecording> => {
          return kept;
        },
        getOriginalAnalysis: async (): Promise<string> => {
          return ORIGINAL_ANALYSIS;
        },
      },
      callModel: model.callModel,
      judge: judge().callModel,
      persona: "DRAFT PERSONA",
    });

    const request: ReplayRequest = replay.mock.calls[0]![0];

    expect(request.projectId).toEqual(new ObjectID(PROJECT_ID));
    expect(request.recording).toBe(kept);
    expect(request.callModel).toBe(model.callModel);
    expect(request.persona).toBe("DRAFT PERSONA");
  });

  test("the result: the case, how the original was graded then and now, and the replay with its counts", async () => {
    mockReplay(
      replayResult({
        stopReason: AIRunStopReason.ToolCalls,
        providerName: "Anthropic",
        modelName: "claude-opus-5-5",
        answers: { exact: 4, nearbyTime: 1, notRecorded: 2 },
        unrecordedToolCallCount: 2,
      }),
    );

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source(),
      callModel: modelUnderTest().callModel,
      judge: judge().callModel,
    });

    expect(result).toEqual({
      runId: "run-1",
      projectId: PROJECT_ID,
      subjectType: "Incident",
      subjectId: "22222222-2222-4222-8222-222222222222",
      rootCause: ROOT_CAUSE,
      original: {
        autoGrade: AIRunAutoGrade.Mismatch,
        humanVerdict: AIRunHumanVerdict.Rejected,
        judgeGrade: AIRunAutoGrade.Partial,
        hasAnalysis: true,
        llmCallCount: 9,
        toolCallCount: 14,
        totalTokens: 52_000,
      },
      replay: {
        analysisMarkdown: REPLAY_ANALYSIS,
        judgeGrade: AIRunAutoGrade.Match,
        llmCallCount: 4,
        toolCallCount: 6,
        totalTokens: 21_000,
        answers: { exact: 4, nearbyTime: 1, notRecorded: 2 },
        stopReason: AIRunStopReason.ToolCalls,
        providerName: "Anthropic",
        modelName: "claude-opus-5-5",
      },
    });
  });

  test("a replay with no stop reason, provider or model carries none", async () => {
    mockReplay();

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source(),
      callModel: modelUnderTest().callModel,
    });

    expect(Object.keys(result.replay!).sort()).toEqual([
      "analysisMarkdown",
      "answers",
      "judgeGrade",
      "llmCallCount",
      "toolCallCount",
      "totalTokens",
    ]);
  });

  test("no original analysis posted: nothing to grade there, and the replay is still graded", async () => {
    mockReplay();
    const grader: FakeModel = judge();

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source({ analysis: null }),
      callModel: modelUnderTest().callModel,
      judge: grader.callModel,
    });

    expect(result.original.hasAnalysis).toBe(false);
    expect(result.original.judgeGrade).toBeUndefined();
    expect(grader.calls).toHaveLength(1);
    expect(result.replay!.judgeGrade).toBe(AIRunAutoGrade.Match);
  });

  test("a judge's answer that cannot be read is no grade, and no error", async () => {
    mockReplay();

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source(),
      callModel: modelUnderTest().callModel,
      judge: judge({ original: "MATCH or MISMATCH", replay: "unsure" })
        .callModel,
    });

    expect(result.original.judgeGrade).toBeNull();
    expect(result.replay!.judgeGrade).toBeNull();
    expect(result.error).toBeUndefined();
  });
});

describe("ReplayRunner.runCase: a failure is its case's, and says which step failed", () => {
  test("an original that cannot be read or graded: no grade for it, the replay still runs and is graded", async () => {
    mockReplay();

    for (const failing of [
      {
        source: source({ analysis: new Error("feed unreadable") }),
        judge: judge(),
      },
      { source: source(), judge: judge({ original: "THROW" }) },
    ]) {
      const result: ReplayCaseResult = await ReplayRunner.runCase({
        replayCase: replayCase("run-1"),
        source: failing.source,
        callModel: modelUnderTest().callModel,
        judge: failing.judge.callModel,
      });

      expect(result.original.judgeGrade).toBeNull();
      expect(result.error).toMatch(
        /^The original analysis could not be graded: (feed unreadable|judge is down)$/,
      );
      expect(result.replay!.judgeGrade).toBe(AIRunAutoGrade.Match);
    }
  });

  test("a replay that fails: no replay, and the error says so", async () => {
    mockReplay(new Error("429 Too Many Requests"));

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source(),
      callModel: modelUnderTest().callModel,
      judge: judge().callModel,
    });

    expect(result.replay).toBeUndefined();
    expect(result.error).toBe("The replay failed: 429 Too Many Requests");
    // The original was graded before the replay failed.
    expect(result.original.judgeGrade).toBe(AIRunAutoGrade.Partial);
  });

  test("both an original that cannot be graded and a failed replay are told, in order", async () => {
    mockReplay(new Error("model gone"));

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source(),
      callModel: modelUnderTest().callModel,
      judge: judge({ original: "THROW" }).callModel,
    });

    expect(result.error).toBe(
      "The original analysis could not be graded: judge is down The replay failed: model gone",
    );
  });

  test("a replay that cannot be graded keeps the replay, with no grade", async () => {
    mockReplay();

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source(),
      callModel: modelUnderTest().callModel,
      judge: judge({ replay: "THROW" }).callModel,
    });

    expect(result.replay!.analysisMarkdown).toBe(REPLAY_ANALYSIS);
    expect(result.replay!.judgeGrade).toBeNull();
    expect(result.error).toBe("The replay could not be graded: judge is down");
  });

  test("an error that is not an Error is told as text", async () => {
    jest
      .spyOn(ReplayInvestigation, "replay")
      .mockRejectedValue("socket hang up");

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source(),
      callModel: modelUnderTest().callModel,
      judge: judge().callModel,
    });

    expect(result.error).toBe("The replay failed: socket hang up");
  });
});

describe("ReplayRunner.runCase with the real replay", () => {
  test("replays the recording offline with the model under test, then grades it", async () => {
    const executeTool: SpyInstance<typeof AIToolbox.executeTool> = jest.spyOn(
      AIToolbox,
      "executeTool",
    );
    const executeWithLogging: SpyInstance<typeof AIService.executeWithLogging> =
      jest.spyOn(AIService, "executeWithLogging");
    const calls: Array<ObservabilityAssistantModelCall> = [];
    let loopCallCount: number = 0;

    // Grades, investigates and answers: one model for all of it.
    const callModel: PinnedModelCall = async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      calls.push(call);

      if (call.maxTokens === GRADING_MAX_TOKENS) {
        return { content: "MATCH", tokenCount: 5 };
      }

      loopCallCount++;

      if (loopCallCount === 1) {
        return {
          content: "",
          toolCalls: [
            {
              id: "call_1",
              name: "search_logs",
              arguments: { query: "checkout" },
            },
          ],
          stopReason: "tool_use",
          tokenCount: 800,
        };
      }

      return {
        content: "The pool ran dry [C1].",
        stopReason: "stop",
        tokenCount: 200,
      };
    };

    const result: ReplayCaseResult = await ReplayRunner.runCase({
      replayCase: replayCase("run-1"),
      source: source(),
      callModel,
    });

    expect(result.error).toBeUndefined();
    expect(result.replay).toEqual({
      analysisMarkdown: "The pool ran dry [C1].",
      judgeGrade: AIRunAutoGrade.Match,
      llmCallCount: 2,
      toolCallCount: 1,
      totalTokens: 1000,
      answers: { exact: 1, nearbyTime: 0, notRecorded: 0 },
    });
    expect(result.original.judgeGrade).toBe(AIRunAutoGrade.Match);
    // Two loop calls and two grades.
    expect(calls).toHaveLength(4);
    expect(executeTool).not.toHaveBeenCalled();
    expect(executeWithLogging).not.toHaveBeenCalled();
  });
});

describe("ReplayRunner.run", () => {
  test("takes the cases one at a time, in order, and a failed case never stops the run", async () => {
    const order: Array<string> = [];
    jest
      .spyOn(ReplayInvestigation, "replay")
      .mockImplementation(
        async (request: ReplayRequest): Promise<ReplayResult> => {
          const contextText: string = request.recording.inputs.contextText;
          order.push(`replay ${contextText}`);

          if (contextText === "run-2") {
            throw new Error("model gone");
          }

          return replayResult();
        },
      );

    const told: Array<string> = [];
    const results: Array<ReplayCaseResult> = await ReplayRunner.run({
      cases: [replayCase("run-1"), replayCase("run-2"), replayCase("run-3")],
      source: {
        getRecording: async (
          fromCase: ReplayCase,
        ): Promise<InvestigationRecording> => {
          order.push(`read ${fromCase.runId}`);
          return {
            ...recording(),
            inputs: { ...recording().inputs, contextText: fromCase.runId },
          };
        },
        getOriginalAnalysis: async (): Promise<string> => {
          return ORIGINAL_ANALYSIS;
        },
      },
      callModel: modelUnderTest().callModel,
      judge: judge().callModel,
      onCase: (
        result: ReplayCaseResult,
        index: number,
        count: number,
      ): void => {
        told.push(`${index + 1}/${count} ${result.runId}`);
      },
    });

    expect(
      results.map((result: ReplayCaseResult): string => {
        return result.runId;
      }),
    ).toEqual(["run-1", "run-2", "run-3"]);
    expect(results[1]!.error).toBe("The replay failed: model gone");
    expect(results[2]!.replay!.judgeGrade).toBe(AIRunAutoGrade.Match);
    // One case finished before the next began.
    expect(order).toEqual([
      "read run-1",
      "replay run-1",
      "read run-2",
      "replay run-2",
      "read run-3",
      "replay run-3",
    ]);
    expect(told).toEqual(["1/3 run-1", "2/3 run-2", "3/3 run-3"]);
  });

  test("no cases, no results", async () => {
    expect(
      await ReplayRunner.run({
        cases: [],
        source: source(),
        callModel: modelUnderTest().callModel,
      }),
    ).toEqual([]);
  });
});

describe("ReplayRunner.summarize", () => {
  function compared(
    runId: string,
    original: AIRunAutoGrade | null | undefined,
    replay: AIRunAutoGrade | null,
    fields: Partial<ReplayCaseResult> = {},
  ): ReplayCaseResult {
    return {
      runId,
      projectId: PROJECT_ID,
      subjectType: "Incident",
      subjectId: "s",
      rootCause: ROOT_CAUSE,
      original: { hasAnalysis: true, judgeGrade: original, totalTokens: 1000 },
      replay: {
        analysisMarkdown: REPLAY_ANALYSIS,
        judgeGrade: replay,
        llmCallCount: 3,
        toolCallCount: 4,
        totalTokens: 400,
        answers: { exact: 3, nearbyTime: 1, notRecorded: 1 },
      },
      ...fields,
    };
  }

  test("counts better, same and worse among the cases both grades were given for", () => {
    const summary: ReplaySummary = ReplayRunner.summarize([
      compared("better", AIRunAutoGrade.Mismatch, AIRunAutoGrade.Match),
      compared("better-too", AIRunAutoGrade.Partial, AIRunAutoGrade.Match),
      compared("same", AIRunAutoGrade.Partial, AIRunAutoGrade.Partial),
      compared("worse", AIRunAutoGrade.Match, AIRunAutoGrade.Mismatch),
    ]);

    expect(summary.comparedCount).toBe(4);
    expect(summary.improvedCount).toBe(2);
    expect(summary.unchangedCount).toBe(1);
    expect(summary.worsenedCount).toBe(1);
    expect(summary.original).toEqual({ match: 1, partial: 2, mismatch: 1 });
    expect(summary.replay).toEqual({ match: 2, partial: 1, mismatch: 1 });
  });

  test("a case one grade is missing for is replayed but never compared: both columns count the same cases", () => {
    const summary: ReplaySummary = ReplayRunner.summarize([
      compared("no-original", undefined, AIRunAutoGrade.Match),
      compared("unreadable-original", null, AIRunAutoGrade.Match),
      compared("unreadable-replay", AIRunAutoGrade.Match, null),
    ]);

    expect(summary.replayedCount).toBe(3);
    expect(summary.comparedCount).toBe(0);
    expect(summary.original).toEqual({ match: 0, partial: 0, mismatch: 0 });
    expect(summary.replay).toEqual({ match: 0, partial: 0, mismatch: 0 });
    expect(
      summary.improvedCount + summary.unchangedCount + summary.worsenedCount,
    ).toBe(0);
  });

  test("skipped and failed cases are counted apart, and a replayed case with an error is both", () => {
    const summary: ReplaySummary = ReplayRunner.summarize([
      compared("ok", AIRunAutoGrade.Partial, AIRunAutoGrade.Match),
      {
        ...compared("skipped", undefined, null),
        replay: undefined,
        skipped: ReplaySkipReason.NoRecording,
      },
      {
        ...compared("failed", undefined, null),
        replay: undefined,
        error: "The replay failed: model gone",
      },
      compared("graded-late", AIRunAutoGrade.Match, null, {
        error: "The replay could not be graded: judge is down",
      }),
    ]);

    expect(summary.caseCount).toBe(4);
    expect(summary.skippedCount).toBe(1);
    expect(summary.erroredCount).toBe(2);
    expect(summary.replayedCount).toBe(2);
    expect(summary.comparedCount).toBe(1);
  });

  test("adds up how each tool call was answered, and the tokens of the cases replayed", () => {
    const summary: ReplaySummary = ReplayRunner.summarize([
      compared("a", AIRunAutoGrade.Match, AIRunAutoGrade.Match),
      compared("b", AIRunAutoGrade.Match, AIRunAutoGrade.Match, {
        original: { hasAnalysis: true, judgeGrade: AIRunAutoGrade.Match },
      }),
      {
        ...compared("skipped", undefined, null),
        replay: undefined,
        skipped: ReplaySkipReason.NoRootCause,
      },
    ]);

    expect(summary.answers).toEqual({
      exact: 6,
      nearbyTime: 2,
      notRecorded: 2,
    });
    expect(summary.replayTokens).toBe(800);
    // A run whose tokens were not counted adds none; a skipped case adds none.
    expect(summary.originalTokens).toBe(1000);
  });

  test("nothing to summarize is all zeros", () => {
    expect(ReplayRunner.summarize([])).toEqual({
      caseCount: 0,
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
    });
  });
});
