import EvalJudge from "../../../../../Server/Utils/AI/Eval/EvalJudge";
import { PinnedModelCall } from "../../../../../Server/Utils/AI/Eval/PinnedModel";
import {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
} from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import InvestigationGrader, {
  GRADING_MAX_TOKENS,
} from "../../../../../Server/Utils/AI/SRE/InvestigationGrader";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import { describe, expect, test } from "@jest/globals";

/*
 * THE JUDGE OF AN EVAL (issue #6800): grades an analysis against the root
 * cause people wrote, in the very words production grades a resolved
 * incident's investigation with (InvestigationGrader.getGradingMessages),
 * so a replay's grade means what an AI card's grade means.
 *
 * Under test: the one call it makes - production's messages, no tools, the
 * grader's token cap, temperature 0 - the grade it reads back with
 * production's own parse, and that there is no call at all when there is
 * nothing to grade.
 */

const ROOT_CAUSE: string =
  "The checkout database's connection pool was cut from 40 to 10.";
const ANALYSIS: string =
  "**Most likely root cause** — the pool was cut to 10 connections [C1].";

interface FakeJudge {
  callModel: PinnedModelCall;
  calls: Array<ObservabilityAssistantModelCall>;
}

function judgeAnswering(content: string): FakeJudge {
  const calls: Array<ObservabilityAssistantModelCall> = [];

  return {
    calls,
    callModel: async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      calls.push(call);
      return { content, tokenCount: 12 };
    },
  };
}

describe("EvalJudge.grade", () => {
  test("asks in production's words: the grader's messages, no tools, its token cap, temperature 0", async () => {
    const judge: FakeJudge = judgeAnswering("MATCH");

    await EvalJudge.grade({
      rootCause: ROOT_CAUSE,
      analysisMarkdown: ANALYSIS,
      callModel: judge.callModel,
    });

    expect(judge.calls).toEqual([
      {
        messages: InvestigationGrader.getGradingMessages({
          rootCause: ROOT_CAUSE,
          analysisMarkdown: ANALYSIS,
        }),
        tools: undefined,
        maxTokens: GRADING_MAX_TOKENS,
        temperature: 0,
      },
    ]);
    expect(GRADING_MAX_TOKENS).toBe(20);
  });

  test.each([
    ["MATCH", AIRunAutoGrade.Match],
    ["PARTIAL", AIRunAutoGrade.Partial],
    ["MISMATCH", AIRunAutoGrade.Mismatch],
    ["mismatch", AIRunAutoGrade.Mismatch],
    ["Verdict: PARTIAL.", AIRunAutoGrade.Partial],
  ])(
    "the judge's %p reads as %p",
    async (content: string, grade: AIRunAutoGrade) => {
      expect(
        await EvalJudge.grade({
          rootCause: ROOT_CAUSE,
          analysisMarkdown: ANALYSIS,
          callModel: judgeAnswering(content).callModel,
        }),
      ).toBe(grade);
    },
  );

  test.each([
    ["", "an empty answer"],
    ["I cannot tell.", "no verdict"],
    ["MATCH or PARTIAL", "two verdicts"],
    ["MATCHING", "a verdict inside a longer word"],
  ])(
    "a judge's answer that cannot be read is no grade (%p: %s)",
    async (content: string) => {
      expect(
        await EvalJudge.grade({
          rootCause: ROOT_CAUSE,
          analysisMarkdown: ANALYSIS,
          callModel: judgeAnswering(content).callModel,
        }),
      ).toBeNull();
    },
  );

  test("nothing to grade asks no model: no root cause, or no analysis", async () => {
    for (const [rootCause, analysisMarkdown] of [
      ["", ANALYSIS],
      ["   \n", ANALYSIS],
      [ROOT_CAUSE, ""],
      [ROOT_CAUSE, " \t "],
      [null as unknown as string, ANALYSIS],
      [ROOT_CAUSE, undefined as unknown as string],
    ] as Array<[string, string]>) {
      const judge: FakeJudge = judgeAnswering("MATCH");

      expect(
        await EvalJudge.grade({
          rootCause,
          analysisMarkdown,
          callModel: judge.callModel,
        }),
      ).toBeNull();
      expect(judge.calls).toHaveLength(0);
    }
  });

  test("grades the text trimmed, as production grades a trimmed root cause", async () => {
    const judge: FakeJudge = judgeAnswering("PARTIAL");

    await EvalJudge.grade({
      rootCause: `  ${ROOT_CAUSE}\n`,
      analysisMarkdown: `\n\n${ANALYSIS}  `,
      callModel: judge.callModel,
    });

    expect(judge.calls[0]!.messages).toEqual(
      InvestigationGrader.getGradingMessages({
        rootCause: ROOT_CAUSE,
        analysisMarkdown: ANALYSIS,
      }),
    );
  });

  test("a judge that fails fails the grade: the caller says which grade went wrong", async () => {
    await expect(
      EvalJudge.grade({
        rootCause: ROOT_CAUSE,
        analysisMarkdown: ANALYSIS,
        callModel: async (): Promise<ObservabilityAssistantModelReply> => {
          throw new Error("529 Overloaded");
        },
      }),
    ).rejects.toThrow("529 Overloaded");
  });
});
