import ObservabilityAssistant, {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantResult,
  ObservabilityAssistantStep,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import {
  CONTINUE_ANSWER_INSTRUCTION,
  ELIDED_TOOL_RESULT_PREFIX,
  MAX_ANSWER_CONTINUATIONS,
} from "../../../../Server/Utils/AI/Chat/AgentContextCompactor";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import { LLMMessage } from "../../../../Server/Utils/LLM/LLMService";
import { JSONObject } from "../../../../Types/JSON";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The agent loop behind autonomous investigations (and Slack/Teams
 * answers). What these pin: an investigation with no configured time limit
 * never stops for time — the fix for "kubectl top pods could not run
 * (investigation time budget)" — a configured limit still wraps the run up
 * honestly, a report the output limit cut is finished instead of published
 * half-written, and a long run compacts its context instead of failing.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const MINUTE_MS: number = 60 * 1000;

function response(data: {
  content?: string;
  stopReason?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: JSONObject }>;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    stopReason: data.stopReason,
    llmLog: {
      totalTokens: 10,
      llmProviderName: "Test",
      modelName: "test-model",
    },
  } as unknown as AILogResponse;
}

function toolCallResponse(id: string, name: string): AILogResponse {
  return response({
    stopReason: "tool_use",
    toolCalls: [{ id, name, arguments: {} }],
  });
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

function extraTool(
  name: string,
  execute: (args: JSONObject) => ToolCallOutcome,
): ObservabilityAssistantExtraTool {
  return {
    definition: {
      name,
      description: name,
      inputSchema: { type: "object", properties: {} },
    },
    execute: async (args: JSONObject): Promise<ToolCallOutcome> => {
      return execute(args);
    },
  };
}

function installSpies(): {
  execute: jest.SpyInstance;
  toolbox: jest.SpyInstance;
} {
  const execute: jest.SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue(response({ content: "Final answer." }) as never);
  const toolbox: jest.SpyInstance = jest
    .spyOn(AIToolbox, "executeTool")
    .mockResolvedValue(outcome("3 rows") as never);

  return { execute, toolbox };
}

function request(spy: jest.SpyInstance, index: number): AILogRequest {
  return spy.mock.calls[index]![0] as AILogRequest;
}

function lastUserMessage(messages: Array<LLMMessage>): string | undefined {
  return [...messages].reverse().find((message: LLMMessage) => {
    return message.role === "user";
  })?.content;
}

// Date.now jumps forward by `stepMs` on every read.
function advancingClock(stepMs: number): void {
  let now: number = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => {
    now += stepMs;
    return now;
  });
}

async function ask(
  overrides?: Partial<
    Parameters<typeof ObservabilityAssistant.answerQuestion>[0]
  >,
): Promise<ObservabilityAssistantResult> {
  return ObservabilityAssistant.answerQuestion({
    projectId: ObjectID.generate(),
    props: { isRoot: true },
    question: "Why is node memory at 93%?",
    feature: "AI Incident Investigation",
    ...overrides,
  });
}

describe("ObservabilityAssistant — time limits", () => {
  test("a run with no time limit (null) keeps investigating after hours", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    advancingClock(2 * 60 * MINUTE_MS);

    spies.execute
      .mockResolvedValueOnce(toolCallResponse("a", "query_incidents") as never)
      .mockResolvedValueOnce(toolCallResponse("b", "query_incidents") as never)
      .mockResolvedValueOnce(toolCallResponse("c", "query_incidents") as never)
      .mockResolvedValueOnce(response({ content: "Done." }) as never);

    const result: ObservabilityAssistantResult = await ask({
      maxWallClockMs: null,
      maxLlmCalls: 100,
      maxToolCalls: 300,
    });

    expect(spies.toolbox).toHaveBeenCalledTimes(3);
    expect(result.toolCallCount).toBe(3);
    expect(request(spies.execute, 3).tools).toBeDefined();
    expect(JSON.stringify(request(spies.execute, 3).messages)).not.toContain(
      "time limit",
    );
    expect(result.contentInMarkdown).toBe("Done.");
  });

  test("a configured time limit wraps the run up and says why", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    advancingClock(10 * MINUTE_MS);

    spies.execute
      .mockResolvedValueOnce(toolCallResponse("a", "query_incidents") as never)
      .mockResolvedValue(
        response({ content: "What I found so far." }) as never,
      );

    await ask({ maxWallClockMs: 15 * MINUTE_MS });

    const wrapUp: AILogRequest = request(
      spies.execute,
      spies.execute.mock.calls.length - 1,
    );

    expect(wrapUp.tools).toBeUndefined();
    expect(lastUserMessage(wrapUp.messages)).toContain(
      "time limit configured for this investigation",
    );
  });

  test("a tool call the time limit can no longer hold is skipped, not run", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    advancingClock(10 * MINUTE_MS);

    spies.execute
      .mockResolvedValueOnce(
        response({
          stopReason: "tool_use",
          toolCalls: [
            { id: "a", name: "query_incidents", arguments: {} },
            { id: "b", name: "query_incidents", arguments: {} },
            { id: "c", name: "query_incidents", arguments: {} },
          ],
        }) as never,
      )
      .mockResolvedValue(response({ content: "Partial." }) as never);

    await ask({ maxWallClockMs: 25 * MINUTE_MS });

    expect(spies.toolbox.mock.calls.length).toBeLessThan(3);

    const second: AILogRequest = request(spies.execute, 1);
    const skipped: Array<LLMMessage> = second.messages.filter(
      (message: LLMMessage) => {
        return (
          message.role === "tool" &&
          message.content.startsWith("Skipped: the time limit configured")
        );
      },
    );
    expect(skipped.length).toBeGreaterThan(0);
  });

  test("leaving the limit undefined keeps the interactive chat-ops default", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    advancingClock(2 * MINUTE_MS);

    spies.execute
      .mockResolvedValueOnce(toolCallResponse("a", "query_incidents") as never)
      .mockResolvedValue(response({ content: "Quick answer." }) as never);

    await ask();

    const last: AILogRequest = request(
      spies.execute,
      spies.execute.mock.calls.length - 1,
    );
    expect(last.tools).toBeUndefined();
  });

  test("the step guard wraps up with its own wording, never 'budget'", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();

    spies.execute
      .mockResolvedValueOnce(toolCallResponse("a", "query_incidents") as never)
      .mockResolvedValueOnce(toolCallResponse("b", "query_incidents") as never)
      .mockResolvedValue(response({ content: "Summary." }) as never);

    await ask({ maxWallClockMs: null, maxLlmCalls: 100, maxToolCalls: 2 });

    const last: AILogRequest = request(
      spies.execute,
      spies.execute.mock.calls.length - 1,
    );
    const wrapUp: string | undefined = lastUserMessage(last.messages);

    expect(last.tools).toBeUndefined();
    expect(wrapUp).toContain("very large number of calls");
    expect(wrapUp?.toLowerCase()).not.toContain("budget");
  });

  test("the model is told to wrap up only once", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();

    spies.execute
      .mockResolvedValueOnce(toolCallResponse("a", "query_incidents") as never)
      .mockResolvedValueOnce(
        response({ content: "Cut", stopReason: "length" }) as never,
      )
      .mockResolvedValue(response({ content: "off." }) as never);

    await ask({ maxWallClockMs: null, maxLlmCalls: 100, maxToolCalls: 1 });

    const last: AILogRequest = request(
      spies.execute,
      spies.execute.mock.calls.length - 1,
    );
    const wrapUps: number = last.messages.filter((message: LLMMessage) => {
      return (
        message.role === "user" &&
        message.content.includes("very large number of calls")
      );
    }).length;

    expect(wrapUps).toBe(1);
  });
});

describe("ObservabilityAssistant — finished reports", () => {
  test("continues a report the output limit cut and joins it seamlessly", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();

    spies.execute
      .mockResolvedValueOnce(
        response({
          content: "**Summary** — memory is high because",
          stopReason: "length",
        }) as never,
      )
      .mockResolvedValueOnce(
        response({
          content: " ClickHouse holds a large working set.",
        }) as never,
      );

    const result: ObservabilityAssistantResult = await ask({
      maxWallClockMs: null,
    });

    expect(result.contentInMarkdown).toBe(
      "**Summary** — memory is high because ClickHouse holds a large working set.",
    );
    expect(result.llmCallCount).toBe(2);

    const continuation: AILogRequest = request(spies.execute, 1);
    expect(continuation.tools).toBeUndefined();
    expect(
      continuation.messages[continuation.messages.length - 1]!.content,
    ).toBe(CONTINUE_ANSWER_INSTRUCTION);
  });

  test("stops continuing after the maximum and returns what it has", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    let part: number = 0;

    spies.execute.mockImplementation((() => {
      part++;
      return Promise.resolve(
        response({ content: `[part ${part}]`, stopReason: "length" }),
      );
    }) as never);

    const result: ObservabilityAssistantResult = await ask({
      maxWallClockMs: null,
    });

    expect(spies.execute).toHaveBeenCalledTimes(MAX_ANSWER_CONTINUATIONS + 1);
    expect(result.contentInMarkdown).toContain("[part 1]");
    expect(result.contentInMarkdown).toContain(
      `[part ${MAX_ANSWER_CONTINUATIONS + 1}]`,
    );
  });
});

describe("ObservabilityAssistant — run-scoped tools", () => {
  test("runs an extra tool itself and cites it", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const executed: Array<JSONObject> = [];
    const steps: Array<ObservabilityAssistantStep> = [];

    spies.execute
      .mockResolvedValueOnce(
        response({
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "a",
              name: "run_kubectl",
              arguments: { command: "kubectl top pods -A" },
            },
          ],
        }) as never,
      )
      .mockResolvedValueOnce(
        response({ content: "ClickHouse [C1]." }) as never,
      );

    const result: ObservabilityAssistantResult = await ask({
      maxWallClockMs: null,
      extraTools: [
        extraTool("run_kubectl", (args: JSONObject) => {
          executed.push(args);
          return outcome("clickhouse-0 120Gi");
        }),
      ],
      onStep: async (step: ObservabilityAssistantStep): Promise<void> => {
        steps.push(step);
      },
    });

    expect(executed).toEqual([{ command: "kubectl top pods -A" }]);
    expect(spies.toolbox).not.toHaveBeenCalled();
    expect(
      result.citations.map((citation: AIChatCitation): string => {
        return citation.toolName;
      }),
    ).toEqual(["run_kubectl"]);
    expect(result.contentInMarkdown).toBe("ClickHouse [C1].");
    expect(
      steps.map((step: ObservabilityAssistantStep) => {
        return step.type;
      }),
    ).toEqual([
      "llm_started",
      "llm_completed",
      "tool_started",
      "tool_completed",
      "llm_started",
      "llm_completed",
    ]);
  });

  test("an excluded tool is refused even when the model names it", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();

    spies.execute
      .mockResolvedValueOnce(
        toolCallResponse("a", "get_ai_investigation") as never,
      )
      .mockResolvedValueOnce(response({ content: "Answer." }) as never);

    await ask({
      maxWallClockMs: null,
      excludeToolNames: ["get_ai_investigation"],
    });

    expect(spies.toolbox).not.toHaveBeenCalled();

    const offered: Array<string> = (request(spies.execute, 0).tools || []).map(
      (tool: { name: string }) => {
        return tool.name;
      },
    );
    expect(offered).not.toContain("get_ai_investigation");
  });

  /*
   * Slack and Teams answers and autonomous investigations change nothing:
   * an investigation runs as OneUptime, with nobody to make a change as,
   * and an answer has nobody's approval. They offer no tool that changes
   * the project, and refuse one the model names anyway, without running it.
   */
  test.each([
    "acknowledge_incident",
    "resolve_alert",
    "page_on_call_policy",
    "open_code_pull_request",
  ])(
    "a tool that changes the project (%s) is refused even when the model names it",
    async (name: string) => {
      expect(AIToolbox.isMutationTool(name)).toBe(true);

      const spies: ReturnType<typeof installSpies> = installSpies();

      spies.execute
        .mockResolvedValueOnce(toolCallResponse("a", name) as never)
        .mockResolvedValueOnce(response({ content: "Answer." }) as never);

      await ask({ maxWallClockMs: null });

      expect(spies.toolbox).not.toHaveBeenCalled();

      const offered: Array<string> = (
        request(spies.execute, 0).tools || []
      ).map((tool: { name: string }) => {
        return tool.name;
      });
      expect(offered).not.toContain(name);

      const answered: LLMMessage | undefined = request(
        spies.execute,
        1,
      ).messages.find((message: LLMMessage): boolean => {
        return message.role === "tool";
      });
      expect(answered?.content).toBe(
        `Error: ${name} is not available in this run. Answer with the data you already have.`,
      );
    },
  );
});

describe("ObservabilityAssistant — context compaction", () => {
  test("a long run elides its oldest results instead of overflowing", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const huge: string = "x".repeat(120_000);

    for (let index: number = 0; index < 6; index++) {
      spies.execute.mockResolvedValueOnce(
        toolCallResponse(`call-${index}`, "run_kubectl") as never,
      );
    }
    spies.execute.mockResolvedValueOnce(
      response({ content: "Done." }) as never,
    );

    await ask({
      maxWallClockMs: null,
      maxLlmCalls: 100,
      maxToolCalls: 300,
      extraTools: [
        extraTool("run_kubectl", () => {
          return outcome(huge);
        }),
      ],
    });

    const last: AILogRequest = request(spies.execute, 6);
    const tools: Array<LLMMessage> = last.messages.filter(
      (message: LLMMessage) => {
        return message.role === "tool";
      },
    );

    expect(tools).toHaveLength(6);
    expect(tools[0]!.content.startsWith(ELIDED_TOOL_RESULT_PREFIX)).toBe(true);
    expect(tools[5]!.content).toContain(huge);
  });
});
