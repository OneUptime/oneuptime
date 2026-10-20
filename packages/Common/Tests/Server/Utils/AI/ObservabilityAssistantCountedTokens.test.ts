import ObservabilityAssistant, {
  ObservabilityAssistantResult,
  ObservabilityAssistantStep,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import AiTokenCount from "../../../../Types/AI/AiTokenCount";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #5073: the agent loop behind AI investigations (and Slack and
 * Microsoft Teams answers) adds up the tokens of its calls into the run's
 * total - the "N tokens" an investigation's report shows and the AIRun row
 * keeps. Each call's tokens now count as OneUptime counts them
 * (AiTokenCount), the way the AI Logs and the daily limits do: the issue's
 * calls, which read the system prompt and the tools from the cache, count a
 * fraction of the tokens they sent.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

interface CallTokens {
  totalTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
  cacheCreationTokens?: number | undefined;
}

function response(data: {
  content?: string | undefined;
  toolCalls?:
    | Array<{ id: string; name: string; arguments: JSONObject }>
    | undefined;
  tokens: CallTokens;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    stopReason: data.toolCalls ? "tool_use" : "stop",
    llmLog: {
      ...data.tokens,
      llmProviderName: "Anthropic",
      modelName: "claude-sonnet-5-5",
    },
  } as unknown as AILogResponse;
}

function outcome(text: string): ToolCallOutcome {
  return {
    success: true,
    textForLlm: text,
    result: {
      dataForLlm: text,
      rowCount: 1,
      citationLabel: text,
      redactionCount: 0,
      isTruncated: false,
    },
  };
}

// The issue's first three calls: a cache write, then two cache reads.
const ISSUE_CALLS: Array<CallTokens> = [
  { totalTokens: 24_117, cacheCreationTokens: 20_654 },
  { totalTokens: 28_496, cachedInputTokens: 20_654 },
  { totalTokens: 32_712, cachedInputTokens: 20_654 },
];

async function investigate(
  calls: Array<CallTokens>,
  steps: Array<ObservabilityAssistantStep>,
): Promise<ObservabilityAssistantResult> {
  const execute: jest.SpyInstance = jest.spyOn(AIService, "executeWithLogging");

  calls.forEach((tokens: CallTokens, index: number) => {
    const isLast: boolean = index === calls.length - 1;

    execute.mockResolvedValueOnce(
      response({
        content: isLast ? "The checkout service ran out of memory [C1]." : "",
        toolCalls: isLast
          ? undefined
          : [{ id: `call_${index}`, name: "query_logs", arguments: {} }],
        tokens,
      }) as never,
    );
  });

  jest
    .spyOn(AIToolbox, "executeTool")
    .mockResolvedValue(outcome("3 rows") as never);

  return ObservabilityAssistant.answerQuestion({
    projectId: ObjectID.generate(),
    props: { isRoot: true },
    question: "Why is checkout returning 500 errors?",
    feature: "AI Incident Investigation",
    maxWallClockMs: null,
    onStep: async (step: ObservabilityAssistantStep): Promise<void> => {
      steps.push(step);
    },
  });
}

describe("an investigation's tokens are counted by what they cost", () => {
  test("the run's total is the sum of its calls as counted, not of the tokens they sent", async () => {
    const steps: Array<ObservabilityAssistantStep> = [];
    const result: ObservabilityAssistantResult = await investigate(
      ISSUE_CALLS,
      steps,
    );

    expect(result.llmCallCount).toBe(3);
    // 29,281 + 9,908 + 14,124 - not 85,325.
    expect(result.totalTokens).toBe(29_281 + 9_908 + 14_124);
    expect(result.totalTokens).toBe(
      ISSUE_CALLS.reduce((sum: number, call: CallTokens) => {
        return sum + AiTokenCount.count(call);
      }, 0),
    );
  });

  test("each call's step says its tokens as counted", async () => {
    const steps: Array<ObservabilityAssistantStep> = [];
    await investigate(ISSUE_CALLS, steps);

    expect(
      steps
        .filter((step: ObservabilityAssistantStep) => {
          return step.type === "llm_completed";
        })
        .map((step: ObservabilityAssistantStep) => {
          return step.totalTokens;
        }),
    ).toEqual([29_281, 9_908, 14_124]);
  });

  test("a call that used no cache counts every token, as before", async () => {
    const steps: Array<ObservabilityAssistantStep> = [];
    const result: ObservabilityAssistantResult = await investigate(
      [{ totalTokens: 1_200 }, { totalTokens: 1_800 }],
      steps,
    );

    expect(result.totalTokens).toBe(3_000);
  });

  test("a call whose log reports no tokens at all counts none", async () => {
    const steps: Array<ObservabilityAssistantStep> = [];
    const result: ObservabilityAssistantResult = await investigate([{}], steps);

    expect(result.totalTokens).toBe(0);
  });
});
