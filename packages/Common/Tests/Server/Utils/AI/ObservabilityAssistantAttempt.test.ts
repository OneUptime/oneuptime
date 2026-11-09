import ObservabilityAssistant, {
  ObservabilityAssistantRequest,
  ObservabilityAssistantResult,
  ObservabilityAssistantStep,
  ObservabilityAssistantStepType,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The agent loop's part in "Thinking keeps loading forever" (issue #6437):
 *   (a) a model call that fails for good says so (llm_failed) before the
 *       error goes on to the run's owner, so the step it opened ends;
 *   (b) an owner that asks it to stop (getStopReason) - an attempt whose
 *       run was given to another - stops before its next model or tool
 *       call, with that reason.
 */

const CUSTOMER_TIMEOUT: string =
  "OpenAICompatible API request failed: the LLM provider did not respond within 120 seconds.";

function response(data: {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: object }>;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    stopReason: data.toolCalls ? "tool_use" : "end_turn",
    llmLog: {
      totalTokens: 10,
      llmProviderName: "Test",
      modelName: "test-model",
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
      citationLabel: text.slice(0, 20),
      redactionCount: 0,
      isTruncated: false,
    },
  };
}

describe("ObservabilityAssistant — an attempt's steps", () => {
  let execute: jest.SpyInstance;
  let toolbox: jest.SpyInstance;
  let steps: Array<ObservabilityAssistantStep>;

  function stepTypes(): Array<ObservabilityAssistantStepType> {
    return steps.map(
      (step: ObservabilityAssistantStep): ObservabilityAssistantStepType => {
        return step.type;
      },
    );
  }

  function ask(
    overrides: Partial<ObservabilityAssistantRequest> = {},
  ): Promise<ObservabilityAssistantResult> {
    return ObservabilityAssistant.answerQuestion({
      projectId: ObjectID.generate(),
      props: { isRoot: true },
      question: "Why is checkout failing?",
      feature: "AI Incident Investigation",
      onStep: async (step: ObservabilityAssistantStep): Promise<void> => {
        steps.push(step);
      },
      ...overrides,
    });
  }

  beforeEach(() => {
    steps = [];
    execute = jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue(response({ content: "Final answer." }) as never);
    toolbox = jest
      .spyOn(AIToolbox, "executeTool")
      .mockResolvedValue(outcome("3 rows") as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a model call that fails ends its step, saying why, and the error goes on", async () => {
    const failure: Error = new Error(CUSTOMER_TIMEOUT);
    execute.mockRejectedValue(failure);

    await expect(ask()).rejects.toBe(failure);

    expect(stepTypes()).toEqual(["llm_started", "llm_failed"]);
    expect(steps[1]!.errorMessage).toBe(CUSTOMER_TIMEOUT);
  });

  test("so does one that fails after the tools ran: every step it opened ends", async () => {
    execute
      .mockResolvedValueOnce(
        response({
          toolCalls: [{ id: "a", name: "query_incidents", arguments: {} }],
        }) as never,
      )
      .mockRejectedValueOnce(new Error("socket hang up"));

    await expect(ask()).rejects.toThrow("socket hang up");

    expect(stepTypes()).toEqual([
      "llm_started",
      "llm_completed",
      "tool_started",
      "tool_completed",
      "llm_started",
      "llm_failed",
    ]);
  });

  test("a failure's words are kept to 400 characters on the step", async () => {
    execute.mockRejectedValue(new Error(`timed out ${"x".repeat(1000)}`));

    await expect(ask()).rejects.toThrow("timed out");

    expect(steps[1]!.errorMessage).toHaveLength(400);
  });

  test("a failure that is not an Error is worded too", async () => {
    execute.mockRejectedValue("provider unreachable");

    await expect(ask()).rejects.toBe("provider unreachable");

    expect(steps[1]).toEqual({
      type: "llm_failed",
      errorMessage: "provider unreachable",
    });
  });

  test("a step that cannot be written never hides the model's failure", async () => {
    execute.mockRejectedValue(new Error(CUSTOMER_TIMEOUT));

    await expect(
      ask({
        onStep: async (): Promise<void> => {
          throw new Error("db down");
        },
      }),
    ).rejects.toThrow(CUSTOMER_TIMEOUT);
  });

  test("an attempt asked to stop before it starts never calls the model", async () => {
    await expect(
      ask({
        getStopReason: (): string | null => {
          return "This attempt stopped.";
        },
      }),
    ).rejects.toThrow("This attempt stopped.");

    expect(execute).not.toHaveBeenCalled();
    expect(steps).toEqual([]);
  });

  test("asked to stop after the model answered, the tools it asked for do not run", async () => {
    let asked: number = 0;
    execute.mockResolvedValueOnce(
      response({
        toolCalls: [{ id: "a", name: "query_incidents", arguments: {} }],
      }) as never,
    );

    await expect(
      ask({
        getStopReason: (): string | null => {
          asked++;
          // Fine before the model call; the run moved on by the tool call.
          return asked > 1 ? "This attempt stopped." : null;
        },
      }),
    ).rejects.toThrow("This attempt stopped.");

    expect(toolbox).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(stepTypes()).toEqual(["llm_started", "llm_completed"]);
  });

  test("an owner that never asks to stop changes nothing", async () => {
    execute
      .mockResolvedValueOnce(
        response({
          toolCalls: [{ id: "a", name: "query_incidents", arguments: {} }],
        }) as never,
      )
      .mockResolvedValueOnce(response({ content: "Done." }) as never);

    const answer: ObservabilityAssistantResult = await ask({
      getStopReason: (): string | null => {
        return null;
      },
    });

    expect(answer.contentInMarkdown).toContain("Done.");
    expect(toolbox).toHaveBeenCalledTimes(1);
    expect(stepTypes()).not.toContain("llm_failed");
  });
});
