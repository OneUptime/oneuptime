import ObservabilityAssistant, {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
  ObservabilityAssistantRequest,
  ObservabilityAssistantResult,
  ObservabilityAssistantStep,
  ObservabilityAssistantToolOutcome,
  ObservabilityAssistantTransport,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { frameToolResult } from "../../../../Server/Utils/AI/Chat/AgentContextCompactor";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "../../../../Server/Utils/LLM/LLMService";
import logger from "../../../../Server/Utils/Logger";
import AIAgentRunLimitsHelper from "../../../../Types/AI/AIAgentRunLimits";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import AiTokenCount from "../../../../Types/AI/AiTokenCount";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE AGENT LOOP'S TRANSPORT, CLOCK AND TOOL OUTCOMES (issue #6800).
 *
 * The loop behind AI investigations (and Slack and Microsoft Teams answers)
 * gained three things for replaying an investigation offline:
 *
 *   - transport: where its model calls and toolbox calls go. A replay's
 *     model calls go to the model under test, and its tool calls are
 *     answered from a recording - never the project's LLM provider through
 *     AIService, never the project's data through the toolbox. Without one,
 *     the run is the run it always was.
 *   - currentTime: the time the prompt names as now (a replay names the
 *     time the original run started).
 *   - onToolOutcome: told every tool call the loop ran and what the model
 *     was handed back - a result or an error - so an investigation can
 *     record it. A listener that throws never breaks the run.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const LOG_ARGS: JSONObject = { query: "checkout", limit: 50 };

function toolResult(
  text: string,
  fields: {
    rowCount?: number;
    citationLabel?: string;
    isTruncated?: boolean;
  } = {},
): ToolCallOutcome {
  return {
    success: true,
    textForLlm: text,
    result: {
      dataForLlm: text,
      rowCount: fields.rowCount ?? 3,
      citationLabel: fields.citationLabel ?? "Logs matching checkout",
      citationTarget: {
        type: AIChatCitationTargetType.Logs,
        params: { query: "checkout" },
      },
      redactionCount: 0,
      isTruncated: fields.isTruncated ?? false,
    },
  };
}

function toolFailure(text: string): ToolCallOutcome {
  return { success: false, textForLlm: text, errorMessage: text };
}

interface FakeTransport extends ObservabilityAssistantTransport {
  modelCalls: Array<ObservabilityAssistantModelCall>;
  toolCalls: Array<{ name: string; arguments: JSONObject }>;
}

function transport(data: {
  replies: Array<ObservabilityAssistantModelReply>;
  answerTool?:
    | ((call: { name: string; arguments: JSONObject }) => ToolCallOutcome)
    | undefined;
}): FakeTransport {
  const modelCalls: Array<ObservabilityAssistantModelCall> = [];
  const toolCalls: Array<{ name: string; arguments: JSONObject }> = [];

  return {
    modelCalls,
    toolCalls,
    callModel: async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      modelCalls.push(call);

      const reply: ObservabilityAssistantModelReply | undefined =
        data.replies[modelCalls.length - 1];

      if (!reply) {
        throw new Error(`No scripted reply for call ${modelCalls.length}.`);
      }

      return reply;
    },
    executeTool: async (call: {
      name: string;
      arguments: JSONObject;
    }): Promise<ToolCallOutcome> => {
      toolCalls.push(call);
      return data.answerTool
        ? data.answerTool(call)
        : toolResult(`rows for ${call.name}`);
    },
  };
}

function callTools(
  toolCalls: Array<LLMToolCall>,
  tokenCount: number = 1000,
): ObservabilityAssistantModelReply {
  return {
    content: "",
    toolCalls,
    stopReason: "tool_use",
    tokenCount,
    providerName: "Anthropic",
    modelName: "claude-opus-5-5",
  };
}

function answerWith(
  content: string,
  tokenCount: number = 200,
): ObservabilityAssistantModelReply {
  return {
    content,
    stopReason: "stop",
    tokenCount,
    providerName: "Anthropic",
    modelName: "claude-opus-5-5",
  };
}

function ask(
  overrides: Partial<ObservabilityAssistantRequest> = {},
): Promise<ObservabilityAssistantResult> {
  return ObservabilityAssistant.answerQuestion({
    projectId: PROJECT_ID,
    props: { isRoot: true, tenantId: PROJECT_ID },
    question: "Why is checkout returning 500 errors?",
    feature: "AI Incident Investigation",
    aiContext: null,
    runLimits: AIAgentRunLimitsHelper.getDefault(),
    ...overrides,
  });
}

function toolMessage(
  messages: Array<LLMMessage>,
  toolCallId: string,
): string | undefined {
  return messages.find((message: LLMMessage): boolean => {
    return message.role === "tool" && message.toolCallId === toolCallId;
  })?.content;
}

describe("ObservabilityAssistant with a transport", () => {
  let executeWithLogging: SpyInstance<typeof AIService.executeWithLogging>;
  let executeTool: SpyInstance<typeof AIToolbox.executeTool>;

  beforeEach(() => {
    executeWithLogging = jest.spyOn(AIService, "executeWithLogging");
    executeTool = jest.spyOn(AIToolbox, "executeTool");
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every model call goes to the transport: no project provider, no AI Log, no bill", async () => {
    const fake: FakeTransport = transport({
      replies: [answerWith("Checkout is fine.")],
    });

    const result: ObservabilityAssistantResult = await ask({ transport: fake });

    expect(fake.modelCalls).toHaveLength(1);
    expect(executeWithLogging).not.toHaveBeenCalled();
    expect(result.contentInMarkdown).toBe("Checkout is fine.");
  });

  test("the transport is handed the conversation, the tools, the output limit and the loop's temperature", async () => {
    const fake: FakeTransport = transport({
      replies: [answerWith("Checkout is fine.")],
    });

    await ask({ transport: fake, maxOutputTokens: 4096 });

    const call: ObservabilityAssistantModelCall = fake.modelCalls[0]!;

    expect(
      call.messages.map((message: LLMMessage) => {
        return message.role;
      }),
    ).toEqual(["system", "user"]);
    expect(call.messages[1]!.content).toBe(
      "Why is checkout returning 500 errors?",
    );
    expect(
      (call.tools || []).map((tool: LLMToolDefinition): string => {
        return tool.name;
      }),
    ).toContain("search_logs");
    expect(call.maxTokens).toBe(4096);
    expect(call.temperature).toBe(0.2);
  });

  test("without an output limit, the loop's own", async () => {
    const fake: FakeTransport = transport({
      replies: [answerWith("Checkout is fine.")],
    });

    await ask({ transport: fake });

    expect(fake.modelCalls[0]!.maxTokens).toBe(1500);
  });

  test("each call is handed a copy of the conversation: the loop's later turns never change what an earlier call was sent", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools([{ id: "call_1", name: "search_logs", arguments: LOG_ARGS }]),
        answerWith("The pool ran dry [C1]."),
      ],
    });

    await ask({ transport: fake });

    expect(fake.modelCalls[0]!.messages).toHaveLength(2);
    expect(fake.modelCalls[1]!.messages.length).toBeGreaterThan(2);
    expect(fake.modelCalls[0]!.messages).not.toBe(fake.modelCalls[1]!.messages);
  });

  test("the toolbox's calls go to the transport, with the arguments the model gave, and their answers reach the model", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools([
          { id: "call_1", name: "search_logs", arguments: LOG_ARGS },
          {
            id: "call_2",
            name: "query_metrics",
            arguments: { metricName: "db.pool.in_use" },
          },
        ]),
        answerWith("The pool ran dry [C1]."),
      ],
      answerTool: (call: { name: string }): ToolCallOutcome => {
        return call.name === "search_logs"
          ? toolResult("3 rows: pool exhausted")
          : toolFailure("Error: no metric named db.pool.in_use.");
      },
    });

    const result: ObservabilityAssistantResult = await ask({ transport: fake });

    expect(fake.toolCalls).toEqual([
      { name: "search_logs", arguments: LOG_ARGS },
      { name: "query_metrics", arguments: { metricName: "db.pool.in_use" } },
    ]);
    expect(executeTool).not.toHaveBeenCalled();

    const sent: Array<LLMMessage> = fake.modelCalls[1]!.messages;

    expect(toolMessage(sent, "call_1")).toBe(
      frameToolResult({
        citationId: "C1",
        rowCount: 3,
        text: "3 rows: pool exhausted",
      }),
    );
    expect(toolMessage(sent, "call_2")).toBe(
      "Error: no metric named db.pool.in_use.",
    );
    expect(result.citations).toHaveLength(1);
    expect(result.toolCallCount).toBe(2);
  });

  test("a transport's tool call that throws is an error the model can work around, and the run goes on", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools([{ id: "call_1", name: "search_logs", arguments: LOG_ARGS }]),
        answerWith("I could not read the logs."),
      ],
      answerTool: (): ToolCallOutcome => {
        throw new Error("recording unreadable");
      },
    });
    const outcomes: Array<ObservabilityAssistantToolOutcome> = [];

    const result: ObservabilityAssistantResult = await ask({
      transport: fake,
      onToolOutcome: (outcome: ObservabilityAssistantToolOutcome): void => {
        outcomes.push(outcome);
      },
    });

    const errorText: string =
      "Error executing search_logs: recording unreadable. Adjust the arguments and try again, or answer with the data you already have.";

    expect(toolMessage(fake.modelCalls[1]!.messages, "call_1")).toBe(errorText);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.success).toBe(false);
    expect(outcomes[0]!.textForLlm).toBe(errorText);
    expect(result.contentInMarkdown).toBe("I could not read the logs.");
  });

  test("an extra tool still runs its own execute; the transport is not asked", async () => {
    const extraRuns: Array<JSONObject> = [];
    const fake: FakeTransport = transport({
      replies: [
        callTools([
          {
            id: "call_1",
            name: "run_kubectl",
            arguments: { command: "get pods" },
          },
        ]),
        answerWith("The pods are crash looping [C1]."),
      ],
    });

    await ask({
      transport: fake,
      extraTools: [
        {
          definition: {
            name: "run_kubectl",
            description: "Run kubectl.",
            inputSchema: { type: "object", properties: {} },
          },
          execute: async (args: JSONObject): Promise<ToolCallOutcome> => {
            extraRuns.push(args);
            return toolResult("checkout-api CrashLoopBackOff", {
              rowCount: 1,
            });
          },
        },
      ],
    });

    expect(extraRuns).toEqual([{ command: "get pods" }]);
    expect(fake.toolCalls).toEqual([]);
  });

  test("an excluded tool and a tool that changes the project are refused before the transport is asked", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools([
          { id: "call_1", name: "get_ai_investigation", arguments: {} },
          { id: "call_2", name: "resolve_incident", arguments: {} },
        ]),
        answerWith("Nothing to add."),
      ],
    });
    const outcomes: Array<ObservabilityAssistantToolOutcome> = [];

    await ask({
      transport: fake,
      excludeToolNames: ["get_ai_investigation"],
      onToolOutcome: (outcome: ObservabilityAssistantToolOutcome): void => {
        outcomes.push(outcome);
      },
    });

    expect(fake.toolCalls).toEqual([]);
    expect(
      outcomes.map((outcome: ObservabilityAssistantToolOutcome) => {
        return [outcome.toolName, outcome.success, outcome.textForLlm];
      }),
    ).toEqual([
      [
        "get_ai_investigation",
        false,
        "Error: get_ai_investigation is not available in this run. Answer with the data you already have.",
      ],
      [
        "resolve_incident",
        false,
        "Error: resolve_incident is not available in this run. Answer with the data you already have.",
      ],
    ]);
  });

  test("the run's tokens are the transport's counts, and it names the provider and model that answered", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools(
          [{ id: "call_1", name: "search_logs", arguments: LOG_ARGS }],
          1234,
        ),
        answerWith("The pool ran dry [C1].", 321),
      ],
    });

    const result: ObservabilityAssistantResult = await ask({ transport: fake });

    expect(result.totalTokens).toBe(1555);
    expect(result.llmCallCount).toBe(2);
    expect(result.providerName).toBe("Anthropic");
    expect(result.modelName).toBe("claude-opus-5-5");
  });

  test("a transport's model call that fails closes its step and fails the run, for its owner to decide", async () => {
    const steps: Array<ObservabilityAssistantStep> = [];

    await expect(
      ask({
        transport: {
          callModel: async (): Promise<ObservabilityAssistantModelReply> => {
            throw new Error("503 Service Unavailable");
          },
          executeTool: async (): Promise<ToolCallOutcome> => {
            return toolResult("unused");
          },
        },
        onStep: async (step: ObservabilityAssistantStep): Promise<void> => {
          steps.push(step);
        },
      }),
    ).rejects.toThrow("503 Service Unavailable");

    expect(
      steps.map((step: ObservabilityAssistantStep) => {
        return step.type;
      }),
    ).toEqual(["llm_started", "llm_failed"]);
    expect(steps[1]!.errorMessage).toBe("503 Service Unavailable");
  });
});

describe("ObservabilityAssistant's clock", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the prompt names the time it is given as now", async () => {
    const fake: FakeTransport = transport({
      replies: [answerWith("Fine.")],
    });

    await ask({
      transport: fake,
      currentTime: new Date("2026-11-10T08:30:00.000Z"),
    });

    expect(fake.modelCalls[0]!.messages[0]!.content).toContain(
      "The current time is 2026-11-10T08:30:00.000Z.",
    );
  });

  test("given none, the time the run starts", async () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2027-02-03T04:05:06.000Z"));
    const fake: FakeTransport = transport({
      replies: [answerWith("Fine.")],
    });

    await ask({ transport: fake });

    expect(fake.modelCalls[0]!.messages[0]!.content).toContain(
      "The current time is 2027-02-03T04:05:06.000Z.",
    );
  });
});

describe("ObservabilityAssistant tells each tool outcome", () => {
  let outcomes: Array<ObservabilityAssistantToolOutcome>;

  beforeEach(() => {
    outcomes = [];
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function record(outcome: ObservabilityAssistantToolOutcome): void {
    outcomes.push(outcome);
  }

  test("a result: what the model read, its rows, its citation, whether it was cut, and how long it took", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools([{ id: "call_1", name: "search_logs", arguments: LOG_ARGS }]),
        answerWith("The pool ran dry [C1]."),
      ],
      answerTool: (): ToolCallOutcome => {
        return toolResult("3 rows: pool exhausted", { isTruncated: true });
      },
    });

    await ask({ transport: fake, onToolOutcome: record });

    expect(outcomes).toHaveLength(1);

    const outcome: ObservabilityAssistantToolOutcome = outcomes[0]!;

    expect(outcome).toEqual({
      toolName: "search_logs",
      toolArguments: LOG_ARGS,
      success: true,
      // What the model read, before it was framed with its citation.
      textForLlm: "3 rows: pool exhausted",
      rowCount: 3,
      citationLabel: "Logs matching checkout",
      citationTarget: {
        type: AIChatCitationTargetType.Logs,
        params: { query: "checkout" },
      },
      isTruncated: true,
      durationMs: expect.any(Number),
    });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("a failure: the error the model read, and how long it took - nothing else", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools([
          {
            id: "call_1",
            name: "query_metrics",
            arguments: { metricName: "db.pool.in_use" },
          },
        ]),
        answerWith("No metric."),
      ],
      answerTool: (): ToolCallOutcome => {
        return toolFailure("Error: no metric named db.pool.in_use.");
      },
    });

    await ask({ transport: fake, onToolOutcome: record });

    expect(outcomes).toEqual([
      {
        toolName: "query_metrics",
        toolArguments: { metricName: "db.pool.in_use" },
        success: false,
        textForLlm: "Error: no metric named db.pool.in_use.",
        durationMs: expect.any(Number),
      },
    ]);
  });

  test("a success without a result is told as the failure the model read", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools([{ id: "call_1", name: "search_logs", arguments: LOG_ARGS }]),
        answerWith("Nothing."),
      ],
      answerTool: (): ToolCallOutcome => {
        return { success: true, textForLlm: "Error: empty." };
      },
    });

    await ask({ transport: fake, onToolOutcome: record });

    expect(outcomes[0]!.success).toBe(false);
    expect(outcomes[0]!.textForLlm).toBe("Error: empty.");
  });

  test("every call, in the order the loop ran them, across rounds", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools([
          { id: "call_1", name: "search_logs", arguments: { query: "a" } },
          { id: "call_2", name: "search_logs", arguments: { query: "b" } },
        ]),
        callTools([
          {
            id: "call_3",
            name: "query_metrics",
            arguments: { metricName: "c" },
          },
        ]),
        answerWith("Done [C1]."),
      ],
    });

    await ask({ transport: fake, onToolOutcome: record });

    expect(
      outcomes.map((outcome: ObservabilityAssistantToolOutcome): string => {
        return `${outcome.toolName} ${JSON.stringify(outcome.toolArguments)}`;
      }),
    ).toEqual([
      'search_logs {"query":"a"}',
      'search_logs {"query":"b"}',
      'query_metrics {"metricName":"c"}',
    ]);
  });

  test("calls the loop never ran - arguments that could not be read, calls past a limit - are not told", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools([
          {
            id: "call_1",
            name: "search_logs",
            arguments: {},
            argumentsParseError: "Unexpected end of JSON input.",
          },
          { id: "call_2", name: "search_logs", arguments: { query: "b" } },
          { id: "call_3", name: "search_logs", arguments: { query: "c" } },
        ]),
        answerWith("Done."),
      ],
    });

    await ask({
      transport: fake,
      onToolOutcome: record,
      runLimits: { ...AIAgentRunLimitsHelper.getDefault(), maxToolCalls: 2 },
    });

    expect(
      outcomes.map((outcome: ObservabilityAssistantToolOutcome) => {
        return outcome.toolArguments;
      }),
    ).toEqual([{ query: "b" }]);
    expect(fake.toolCalls).toEqual([
      { name: "search_logs", arguments: { query: "b" } },
    ]);
  });

  test("a listener that throws is logged, and the run goes on to its answer", async () => {
    const loggedErrors: Array<string> = [];
    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      loggedErrors.push(String(message));
    });
    const fake: FakeTransport = transport({
      replies: [
        callTools([
          { id: "call_1", name: "search_logs", arguments: LOG_ARGS },
          {
            id: "call_2",
            name: "query_metrics",
            arguments: { metricName: "x" },
          },
        ]),
        answerWith("The pool ran dry [C1]."),
      ],
    });

    const result: ObservabilityAssistantResult = await ask({
      transport: fake,
      onToolOutcome: (): void => {
        throw new Error("disk full");
      },
    });

    expect(result.contentInMarkdown).toBe("The pool ran dry [C1].");
    expect(result.toolCallCount).toBe(2);
    // The model still read both results.
    expect(
      fake.modelCalls[1]!.messages.filter((message: LLMMessage) => {
        return message.role === "tool";
      }),
    ).toHaveLength(2);
    expect(
      loggedErrors.filter((message: string): boolean => {
        return message.includes("tool outcome handler");
      }),
    ).toEqual([
      "ObservabilityAssistant: a tool outcome handler failed for search_logs: Error: disk full",
      "ObservabilityAssistant: a tool outcome handler failed for query_metrics: Error: disk full",
    ]);
  });

  test("the live run tells them too: the toolbox's calls, as an investigation records them", async () => {
    jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{ id: "call_1", name: "search_logs", arguments: LOG_ARGS }],
        stopReason: "tool_use",
        llmLog: { totalTokens: 900, llmProviderName: "Anthropic" },
      } as unknown as AILogResponse)
      .mockResolvedValueOnce({
        content: "The pool ran dry [C1].",
        stopReason: "stop",
        llmLog: { totalTokens: 100, llmProviderName: "Anthropic" },
      } as unknown as AILogResponse);
    jest
      .spyOn(AIToolbox, "executeTool")
      .mockResolvedValue(toolResult("3 rows: pool exhausted"));

    await ask({ onToolOutcome: record });

    expect(outcomes).toEqual([
      {
        toolName: "search_logs",
        toolArguments: LOG_ARGS,
        success: true,
        textForLlm: "3 rows: pool exhausted",
        rowCount: 3,
        citationLabel: "Logs matching checkout",
        citationTarget: {
          type: AIChatCitationTargetType.Logs,
          params: { query: "checkout" },
        },
        isTruncated: false,
        durationMs: expect.any(Number),
      },
    ]);
  });

  test("no listener, nothing told and nothing breaks", async () => {
    const fake: FakeTransport = transport({
      replies: [
        callTools([{ id: "call_1", name: "search_logs", arguments: LOG_ARGS }]),
        answerWith("The pool ran dry [C1]."),
      ],
    });

    const result: ObservabilityAssistantResult = await ask({ transport: fake });

    expect(result.citations).toHaveLength(1);
  });
});

describe("ObservabilityAssistant without a transport: the run it always was", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("calls the project's model through AIService, billed and logged, with the request's own fields", async () => {
    const userId: ObjectID = ObjectID.generate();
    const incidentId: ObjectID = ObjectID.generate();
    const aiRunId: ObjectID = ObjectID.generate();
    const llmProviderId: ObjectID = ObjectID.generate();
    const executeWithLogging: SpyInstance<typeof AIService.executeWithLogging> =
      jest.spyOn(AIService, "executeWithLogging").mockResolvedValue({
        content: "Checkout is fine.",
        stopReason: "stop",
        llmLog: {
          totalTokens: 24_117,
          cachedInputTokens: 20_000,
          llmProviderName: "Anthropic",
          modelName: "claude-sonnet-5-5",
        },
      } as unknown as AILogResponse);

    const result: ObservabilityAssistantResult = await ask({
      userId,
      incidentId,
      aiRunId,
      llmProviderId,
      maxOutputTokens: 4096,
    });

    expect(executeWithLogging).toHaveBeenCalledTimes(1);

    const sent: Parameters<typeof AIService.executeWithLogging>[0] =
      executeWithLogging.mock.calls[0]![0];

    expect(sent).toEqual({
      projectId: PROJECT_ID,
      userId,
      incidentId,
      alertId: undefined,
      aiRunId,
      llmProviderId,
      feature: "AI Incident Investigation",
      messages: expect.any(Array),
      tools: expect.any(Array),
      maxTokens: 4096,
      temperature: 0.2,
      storeContentPreviews: false,
    });
    expect(result.contentInMarkdown).toBe("Checkout is fine.");
    expect(result.totalTokens).toBe(
      AiTokenCount.count({
        totalTokens: 24_117,
        cachedInputTokens: 20_000,
        modelName: "claude-sonnet-5-5",
      }),
    );
    expect(result.providerName).toBe("Anthropic");
    expect(result.modelName).toBe("claude-sonnet-5-5");
  });

  test("and the toolbox answers its tool calls, under the run's props", async () => {
    jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{ id: "call_1", name: "search_logs", arguments: LOG_ARGS }],
        stopReason: "tool_use",
        llmLog: { totalTokens: 900 },
      } as unknown as AILogResponse)
      .mockResolvedValueOnce({
        content: "The pool ran dry [C1].",
        stopReason: "stop",
        llmLog: { totalTokens: 100 },
      } as unknown as AILogResponse);
    const executeTool: SpyInstance<typeof AIToolbox.executeTool> = jest
      .spyOn(AIToolbox, "executeTool")
      .mockResolvedValue(toolResult("3 rows: pool exhausted"));

    await ask({});

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0]![0]).toEqual({
      name: "search_logs",
      args: LOG_ARGS,
      ctx: expect.objectContaining({
        projectId: PROJECT_ID,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    });
  });
});
