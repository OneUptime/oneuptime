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
import { ObservabilityChatApp } from "../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import AIRunLimitsReader from "../../../../Server/Utils/AI/AIRunLimitsReader";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import { LLMMessage } from "../../../../Server/Utils/LLM/LLMService";
import Project from "../../../../Models/DatabaseModels/Project";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
  AIRunTimeLimitSource,
  ALERT_AI_INVESTIGATION_LIMITS_LOCATION,
  INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION,
  PROJECT_AI_RUN_LIMITS_LOCATION,
} from "../../../../Types/AI/AIAgentRunLimits";
import {
  NO_PROGRESS_ROUNDS_BEFORE_NUDGE,
  NO_PROGRESS_ROUNDS_BEFORE_STOP,
  REPEATED_FAILURE_LIMIT,
} from "../../../../Types/AI/AgentLoopDetector";
import { JSONObject } from "../../../../Types/JSON";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The agent loop behind autonomous investigations, remediation planning and
 * Slack/Teams answers, and how far a run of it goes (issue #6440: "Why is
 * there a budget? Can we remove all of the artificial limits by default,
 * customers can add them if they need it").
 *
 * With nothing set, a run makes as many model calls and tool calls, and
 * uses as many tokens, as its question needs - a fake model that needs 200
 * tool calls finishes. What stops one:
 *
 *   - its time limit: 120 minutes, unless the project (or the incident or
 *     alert lane) set its own; a Slack or Teams answer is also held to the
 *     chat app's 25 minutes;
 *   - the caps a project sets in Limits per run: model calls, tool calls,
 *     tokens;
 *   - loop detection: the same failing call again and again, or round after
 *     round of results already seen.
 *
 * Each makes the model answer with what it has, told once, in words about
 * that limit only - never a budget - and the result carries the note
 * OneUptime writes under the answer: which limit, linked to its setting.
 *
 * Also pinned: a report the output limit cut is finished instead of
 * published half-written, and a long run compacts its context instead of
 * failing.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const urlModule: { default: { fromString: (url: string) => unknown } } =
    jest.requireActual("../../../../Types/API/URL");

  return {
    ...actual,
    // The dashboard's address, so a stop note links to the setting.
    DashboardClientUrl: urlModule.default.fromString(
      "https://oneuptime.example.com/dashboard",
    ),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

const MINUTE_MS: number = 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID(
  "4c2d3e4f-2222-4333-8444-955566667777",
);

const DASHBOARD_PROJECT: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}`;

const SETTINGS_LINK: string = `[${PROJECT_AI_RUN_LIMITS_LOCATION}](${DASHBOARD_PROJECT}/settings/ai-features#LimitsPerRun)`;

// What runs no longer have. An SLO's error budget is real data, and stays.
const BUDGET: RegExp = /(?<!error )budget/i;

const CHAT_APP: ObservabilityChatApp = {
  name: "Slack",
  incidentCommand: "/oneuptime incident",
  pageCommand: "/oneuptime page",
  askAiUrl: "https://oneuptime.example.com/dashboard/ai",
};

/*
 * The run's clock as Date.now reads it (useClock): it stands still until the
 * fake model or a tool moves it on, as real calls take time.
 */
let nowMs: number = 1_700_000_000_000;

function useClock(): void {
  jest.spyOn(Date, "now").mockImplementation(() => {
    return nowMs;
  });
}

function response(data: {
  content?: string;
  stopReason?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: JSONObject }>;
  tokens?: number;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    stopReason: data.stopReason,
    llmLog: {
      totalTokens: data.tokens ?? 10,
      llmProviderName: "Test",
      modelName: "test-model",
    },
  } as unknown as AILogResponse;
}

function toolCallResponse(
  id: string,
  name: string,
  args?: JSONObject,
): AILogResponse {
  return response({
    stopReason: "tool_use",
    toolCalls: [{ id, name, arguments: args ?? {} }],
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

function failure(text: string): ToolCallOutcome {
  return { success: false, textForLlm: text, errorMessage: text };
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

/*
 * The model answers "Final answer." and every tool returns rows naming
 * what it was asked - so different arguments read different things - unless
 * a test says otherwise. A tool call takes `minutesPerTool` of the clock.
 */
function installSpies(options?: {
  minutesPerTool?: number;
  tool?: (args: JSONObject, callNumber: number) => ToolCallOutcome;
}): {
  execute: jest.SpyInstance;
  toolbox: jest.SpyInstance;
} {
  const execute: jest.SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue(response({ content: "Final answer." }) as never);

  let callNumber: number = 0;

  const toolbox: jest.SpyInstance = jest
    .spyOn(AIToolbox, "executeTool")
    .mockImplementation((async (call: {
      args: JSONObject;
    }): Promise<ToolCallOutcome> => {
      callNumber++;
      nowMs += (options?.minutesPerTool ?? 0) * MINUTE_MS;

      return options?.tool
        ? options.tool(call.args, callNumber)
        : outcome(`rows for ${JSON.stringify(call.args)}`);
    }) as never);

  return { execute, toolbox };
}

// One call the model was sent, as it was at the time.
interface ModelCall {
  messages: Array<LLMMessage>;
  hasTools: boolean;
}

/*
 * A model that needs `toolCallsNeeded` tool calls before it answers -
 * `callsPerResponse` at a time, each reading something new unless
 * `sameCallEveryTime` - and that answers at once whenever it is offered no
 * tools. Each call takes `minutesPerCall` of the run's clock and uses
 * `tokensPerCall` tokens.
 */
function fakeModel(
  execute: jest.SpyInstance,
  data: {
    toolCallsNeeded: number;
    callsPerResponse?: number;
    sameCallEveryTime?: boolean;
    minutesPerCall?: number;
    tokensPerCall?: number;
  },
): Array<ModelCall> {
  const calls: Array<ModelCall> = [];
  let asked: number = 0;

  execute.mockImplementation((async (
    logRequest: AILogRequest,
  ): Promise<AILogResponse> => {
    const hasTools: boolean = Boolean(
      logRequest.tools && logRequest.tools.length > 0,
    );

    calls.push({
      messages: logRequest.messages.map((message: LLMMessage): LLMMessage => {
        return { ...message };
      }),
      hasTools,
    });

    nowMs += (data.minutesPerCall ?? 0) * MINUTE_MS;

    if (!hasTools || asked >= data.toolCallsNeeded) {
      return response({
        content: "Final answer.",
        tokens: data.tokensPerCall,
      });
    }

    const toolCalls: Array<{
      id: string;
      name: string;
      arguments: JSONObject;
    }> = [];

    while (
      toolCalls.length < (data.callsPerResponse ?? 1) &&
      asked < data.toolCallsNeeded
    ) {
      asked++;
      toolCalls.push({
        id: `call-${asked}`,
        name: "query_incidents",
        arguments: data.sameCallEveryTime
          ? { state: "open" }
          : { state: "open", page: asked },
      });
    }

    return response({
      stopReason: "tool_use",
      toolCalls,
      tokens: data.tokensPerCall,
    });
  }) as never);

  return calls;
}

// The project's limits per run, as ProjectService hands them to the run.
function serveProject(
  limits:
    | Partial<
        Pick<
          Project,
          | "aiRunMaxModelCalls"
          | "aiRunMaxToolCalls"
          | "aiRunMaxTokens"
          | "aiRunTimeLimitInMinutes"
        >
      >
    | Error,
): jest.SpyInstance {
  return jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async (): Promise<Project> => {
      if (limits instanceof Error) {
        throw limits;
      }

      const project: Project = new Project();
      Object.assign(project, limits);
      return project;
    }) as never);
}

function request(spy: jest.SpyInstance, index: number): AILogRequest {
  return spy.mock.calls[index]![0] as AILogRequest;
}

function lastCall(calls: Array<ModelCall>): ModelCall {
  return calls[calls.length - 1]!;
}

function lastUserMessage(messages: Array<LLMMessage>): string | undefined {
  return [...messages].reverse().find((message: LLMMessage) => {
    return message.role === "user";
  })?.content;
}

function toolMessages(messages: Array<LLMMessage>): Array<LLMMessage> {
  return messages.filter((message: LLMMessage) => {
    return message.role === "tool";
  });
}

// Everything the model was sent, over every call of the run.
function everythingSent(calls: Array<ModelCall>): string {
  return calls
    .map((call: ModelCall): string => {
      return call.messages
        .map((message: LLMMessage): string => {
          return message.content || "";
        })
        .join("\n");
    })
    .join("\n");
}

async function ask(
  overrides?: Partial<
    Parameters<typeof ObservabilityAssistant.answerQuestion>[0]
  >,
): Promise<ObservabilityAssistantResult> {
  return ObservabilityAssistant.answerQuestion({
    projectId: PROJECT_ID,
    props: { isRoot: true },
    question: "Why is node memory at 93%?",
    feature: "AI Incident Investigation",
    // The caller read the project's notes for OneUptime AI: there are none.
    aiContext: null,
    // What an investigation's runner passes when the project set nothing.
    runLimits: AIAgentRunLimitsHelper.getDefault(),
    ...overrides,
  });
}

describe("ObservabilityAssistant — no limit by default", () => {
  test("a run that needs 200 tool calls makes every one, then answers", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 200,
    });

    const result: ObservabilityAssistantResult = await ask();

    expect(spies.toolbox).toHaveBeenCalledTimes(200);
    expect(result.toolCallCount).toBe(200);
    expect(result.llmCallCount).toBe(201);
    // Offered its tools on every call: nothing asked it to wrap up.
    expect(
      calls.every((call: ModelCall): boolean => {
        return call.hasTools;
      }),
    ).toBe(true);
    expect(result.contentInMarkdown).toBe("Final answer.");
    expect(result.stopReason).toBeUndefined();
    expect(result.stopNoteInMarkdown).toBeUndefined();

    const sent: string = lastCall(calls)
      .messages.map((message: LLMMessage): string => {
        return message.content;
      })
      .join("\n");
    expect(sent).not.toContain("Answer now");
    expect(sent).not.toContain("Skipped:");
    expect(sent).not.toMatch(BUDGET);
  });

  test("one response may ask for 60 tool calls at once, and every one runs", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 60,
      callsPerResponse: 60,
    });

    const result: ObservabilityAssistantResult = await ask();

    expect(spies.toolbox).toHaveBeenCalledTimes(60);
    expect(result.llmCallCount).toBe(2);

    const answered: Array<LLMMessage> = toolMessages(calls[1]!.messages);
    expect(answered).toHaveLength(60);
    expect(
      answered.filter((message: LLMMessage): boolean => {
        return message.content.startsWith("Skipped:");
      }),
    ).toEqual([]);
    expect(result.stopReason).toBeUndefined();
  });

  test("millions of tokens do not stop a run", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 40,
      tokensPerCall: 50_000,
    });

    const result: ObservabilityAssistantResult = await ask();

    expect(result.totalTokens).toBe(41 * 50_000);
    expect(spies.toolbox).toHaveBeenCalledTimes(40);
    expect(
      calls.every((call: ModelCall): boolean => {
        return call.hasTools;
      }),
    ).toBe(true);
    expect(result.stopReason).toBeUndefined();
  });

  test("a run is never stopped for time before its time limit: 115 minutes into the default 120", async () => {
    useClock();
    const spies: ReturnType<typeof installSpies> = installSpies();
    // Five calls of 23 minutes: the sixth starts 115 minutes in.
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 5,
      minutesPerCall: 23,
    });

    const result: ObservabilityAssistantResult = await ask();

    expect(calls).toHaveLength(6);
    expect(
      calls.every((call: ModelCall): boolean => {
        return call.hasTools;
      }),
    ).toBe(true);
    expect(result.toolCallCount).toBe(5);
    expect(result.stopReason).toBeUndefined();
  });
});

describe("ObservabilityAssistant — time limit", () => {
  test("past the default 120 minutes, a run answers with what it has, and the note under it says so", async () => {
    useClock();
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 50,
      minutesPerCall: 30,
    });
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.getDefault();

    const result: ObservabilityAssistantResult = await ask({
      runLimits: limits,
    });

    // Calls asked for at 30, 60 and 90 minutes ran; the one at 120 did not.
    expect(spies.toolbox).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(5);

    const last: ModelCall = lastCall(calls);
    expect(last.hasTools).toBe(false);
    expect(toolMessages(last.messages).pop()).toEqual({
      role: "tool",
      toolCallId: "call-4",
      content:
        "Skipped: this run has reached its time limit of 120 minutes. Answer with the data you already have.",
    });
    expect(lastUserMessage(last.messages)).toBe(
      AIAgentRunLimitsHelper.getWrapUpInstruction(
        AIRunStopReason.TimeLimit,
        limits,
      ),
    );
    expect(lastUserMessage(last.messages)).toMatch(
      /^This run has reached its time limit of 120 minutes\. Answer now with the findings so far/,
    );

    expect(result.stopReason).toBe(AIRunStopReason.TimeLimit);
    expect(result.stopNoteInMarkdown).toBe(
      `_This run stopped at the time limit of 120 minutes per run, the default. Change it in ${SETTINGS_LINK}._`,
    );
    // The note is OneUptime's to place, never part of the model's answer.
    expect(result.contentInMarkdown).toBe("Final answer.");
  });

  test("a project's own time limit of 15 minutes wraps the run up and names the setting", async () => {
    useClock();
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 50,
      minutesPerCall: 4,
    });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.fromSettings({
        timeLimitInMinutes: 15,
      }),
    });

    // At 4, 8 and 12 minutes calls ran; the one asked for at 16 did not.
    expect(spies.toolbox).toHaveBeenCalledTimes(3);
    expect(lastCall(calls).hasTools).toBe(false);
    expect(lastUserMessage(lastCall(calls).messages)).toMatch(
      /^This run has reached its time limit of 15 minutes\. /,
    );
    expect(result.stopReason).toBe(AIRunStopReason.TimeLimit);
    expect(result.stopNoteInMarkdown).toBe(
      `_This run stopped at this project's time limit of 15 minutes per run. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test.each([
    {
      lane: "incident",
      source: AIRunTimeLimitSource.IncidentInvestigation as const,
      location: INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION,
      path: "incidents/ai/settings",
    },
    {
      lane: "alert",
      source: AIRunTimeLimitSource.AlertInvestigation as const,
      location: ALERT_AI_INVESTIGATION_LIMITS_LOCATION,
      path: "alerts/ai/settings",
    },
  ])(
    "an $lane investigation's own time limit wraps it up and names that setting",
    async (lane: {
      lane: string;
      source:
        | AIRunTimeLimitSource.IncidentInvestigation
        | AIRunTimeLimitSource.AlertInvestigation;
      location: string;
      path: string;
    }) => {
      useClock();
      const spies: ReturnType<typeof installSpies> = installSpies();
      const calls: Array<ModelCall> = fakeModel(spies.execute, {
        toolCallsNeeded: 50,
        minutesPerCall: 4,
      });

      const result: ObservabilityAssistantResult = await ask({
        // The lane's 10 minutes come before the project's 300.
        runLimits: AIAgentRunLimitsHelper.fromSettings({
          timeLimitInMinutes: 300,
          lane: { timeLimitInMinutes: 10, source: lane.source },
        }),
      });

      // At 4 and 8 minutes calls ran; the one asked for at 12 did not.
      expect(spies.toolbox).toHaveBeenCalledTimes(2);
      expect(lastUserMessage(lastCall(calls).messages)).toMatch(
        /^This run has reached its time limit of 10 minutes\. /,
      );
      expect(result.stopReason).toBe(AIRunStopReason.TimeLimit);
      expect(result.stopNoteInMarkdown).toBe(
        `_This investigation stopped at the ${lane.lane} investigation time limit of 10 minutes. Change it in [${lane.location}](${DASHBOARD_PROJECT}/${lane.path}#InvestigationLimits)._`,
      );
    },
  );

  test("a tool call the time limit can no longer hold is skipped, not run, and still answered", async () => {
    useClock();
    const spies: ReturnType<typeof installSpies> = installSpies({
      minutesPerTool: 10,
    });
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 3,
      callsPerResponse: 3,
      minutesPerCall: 5,
    });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.fromSettings({
        timeLimitInMinutes: 25,
      }),
    });

    // The model took 5 minutes and each call 10: the third would start at 25.
    expect(spies.toolbox).toHaveBeenCalledTimes(2);

    // Every call the model asked for gets its answer, as providers require.
    const answered: Array<LLMMessage> = toolMessages(calls[1]!.messages);
    expect(
      answered.map((message: LLMMessage): string | undefined => {
        return message.toolCallId;
      }),
    ).toEqual(["call-1", "call-2", "call-3"]);
    expect(answered[2]!.content).toBe(
      "Skipped: this run has reached its time limit of 25 minutes. Answer with the data you already have.",
    );
    expect(calls[1]!.hasTools).toBe(false);
    expect(result.stopReason).toBe(AIRunStopReason.TimeLimit);
  });
});

describe("ObservabilityAssistant — the project's limits per run", () => {
  test("a tool-call cap of 2 wraps the run up after two calls, and the note names it", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 50,
    });
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.fromSettings({
      maxToolCalls: 2,
    });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: limits,
    });

    expect(spies.toolbox).toHaveBeenCalledTimes(2);
    expect(result.toolCallCount).toBe(2);
    expect(
      calls.map((call: ModelCall): boolean => {
        return call.hasTools;
      }),
    ).toEqual([true, true, false]);
    expect(lastUserMessage(lastCall(calls).messages)).toBe(
      AIAgentRunLimitsHelper.getWrapUpInstruction(
        AIRunStopReason.ToolCalls,
        limits,
      ),
    );
    expect(lastUserMessage(lastCall(calls).messages)).toMatch(
      /^This run has made 2 tool calls, the most the project allows per run\. Answer now/,
    );
    expect(result.stopReason).toBe(AIRunStopReason.ToolCalls);
    expect(result.stopNoteInMarkdown).toBe(
      `_This run stopped at this project's limit of 2 tool calls per run. Change it in ${SETTINGS_LINK}._`,
    );
    expect(result.contentInMarkdown).toBe("Final answer.");
  });

  test("the tool-call cap holds inside one batch: the calls past it are skipped", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 5,
      callsPerResponse: 5,
    });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.fromSettings({ maxToolCalls: 2 }),
    });

    expect(spies.toolbox).toHaveBeenCalledTimes(2);

    const answered: Array<LLMMessage> = toolMessages(calls[1]!.messages);
    expect(answered).toHaveLength(5);
    expect(
      answered.slice(2).map((message: LLMMessage): string => {
        return message.content;
      }),
    ).toEqual(
      new Array(3).fill(
        "Skipped: this run has made 2 tool calls, the most the project allows per run. Answer with the data you already have.",
      ),
    );
    expect(calls[1]!.hasTools).toBe(false);
    expect(result.stopReason).toBe(AIRunStopReason.ToolCalls);
  });

  test("a model-call cap of 4: the fourth call is the answer, without tools", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 50,
    });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.fromSettings({ maxModelCalls: 4 }),
    });

    expect(spies.execute).toHaveBeenCalledTimes(4);
    expect(result.llmCallCount).toBe(4);
    expect(
      calls.map((call: ModelCall): boolean => {
        return call.hasTools;
      }),
    ).toEqual([true, true, true, false]);
    expect(spies.toolbox).toHaveBeenCalledTimes(3);
    expect(lastUserMessage(lastCall(calls).messages)).toMatch(
      /^This is the last model call this run may make: the project allows 4 model calls per run\. Answer now/,
    );
    expect(result.stopReason).toBe(AIRunStopReason.ModelCalls);
    expect(result.stopNoteInMarkdown).toBe(
      `_This run stopped at this project's limit of 4 model calls per run. Change it in ${SETTINGS_LINK}._`,
    );
    expect(result.contentInMarkdown).toBe("Final answer.");
  });

  test("a model-call cap of 1: the only call is the answer", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 50,
    });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.fromSettings({ maxModelCalls: 1 }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.hasTools).toBe(false);
    expect(spies.toolbox).not.toHaveBeenCalled();
    expect(lastUserMessage(calls[0]!.messages)).toMatch(
      /^This is the last model call this run may make: the project allows 1 model call per run\. /,
    );
    expect(result.stopReason).toBe(AIRunStopReason.ModelCalls);
  });

  test("a token cap of 1,000: the call that would reach it is the answer", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 50,
      tokensPerCall: 300,
    });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.fromSettings({ maxTokens: 1000 }),
    });

    // 300, 600, 900 tokens; a fourth call uses at least 300 more.
    expect(
      calls.map((call: ModelCall): boolean => {
        return call.hasTools;
      }),
    ).toEqual([true, true, true, false]);
    expect(lastUserMessage(lastCall(calls).messages)).toMatch(
      /^This run is about to reach the project's limit of 1,000 tokens per run\. Answer now/,
    );
    expect(result.totalTokens).toBe(1200);
    expect(result.stopReason).toBe(AIRunStopReason.Tokens);
    expect(result.stopNoteInMarkdown).toBe(
      `_This run stopped at this project's limit of 1,000 tokens per run. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test("a token cap one call already passed stops the run where it is", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 50,
      tokensPerCall: 1500,
    });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.fromSettings({ maxTokens: 1000 }),
    });

    // Any further call would only go further past it.
    expect(calls).toHaveLength(1);
    expect(result.totalTokens).toBe(1500);
    expect(result.contentInMarkdown).toBe("");
    expect(result.stopReason).toBe(AIRunStopReason.Tokens);
    expect(result.stopNoteInMarkdown).toBe(
      `_This run stopped at this project's limit of 1,000 tokens per run. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test("a model-call cap holds while a cut-off answer is finished: no call past it", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    let callNumber: number = 0;

    spies.execute.mockImplementation((async (): Promise<AILogResponse> => {
      callNumber++;

      if (callNumber === 1) {
        return toolCallResponse("a", "query_incidents", { state: "open" });
      }

      // Every answer is cut off by the model's output limit.
      return response({
        content: ` [part ${callNumber - 1}]`,
        stopReason: "length",
      });
    }) as never);

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.fromSettings({ maxModelCalls: 3 }),
    });

    // The tool call, the answer, and one call going on with it: three.
    expect(spies.execute).toHaveBeenCalledTimes(3);
    expect(result.llmCallCount).toBe(3);
    expect(result.contentInMarkdown).toBe(" [part 1] [part 2]");
    expect(result.stopReason).toBe(AIRunStopReason.ModelCalls);
    expect(result.stopNoteInMarkdown).toBe(
      `_This run stopped at this project's limit of 3 model calls per run. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test("a token cap holds while a cut-off answer is finished", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    let callNumber: number = 0;

    spies.execute.mockImplementation((async (): Promise<AILogResponse> => {
      callNumber++;

      return response({
        content: ` [part ${callNumber}]`,
        stopReason: "length",
        tokens: 400,
      });
    }) as never);

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.fromSettings({ maxTokens: 1000 }),
    });

    // 400, then 800 (a call that may reach it, the last), then none past it.
    expect(spies.execute).toHaveBeenCalledTimes(3);
    expect(result.totalTokens).toBe(1200);
    expect(result.contentInMarkdown).toBe(" [part 1] [part 2] [part 3]");
    expect(result.stopReason).toBe(AIRunStopReason.Tokens);
  });

  test("the time limit and a tool-call cap leave a cut-off answer its continuations", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();

    spies.execute
      .mockResolvedValueOnce(
        toolCallResponse("a", "query_incidents", { state: "open" }) as never,
      )
      .mockResolvedValueOnce(
        response({ content: "Cut", stopReason: "length" }) as never,
      )
      .mockResolvedValue(response({ content: " off." }) as never);

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.fromSettings({ maxToolCalls: 1 }),
    });

    expect(spies.execute).toHaveBeenCalledTimes(3);
    expect(result.contentInMarkdown).toBe("Cut off.");
    expect(result.stopReason).toBe(AIRunStopReason.ToolCalls);
  });

  test("the model is told to wrap up only once", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.fromSettings({
      maxToolCalls: 1,
    });

    spies.execute
      .mockResolvedValueOnce(toolCallResponse("a", "query_incidents") as never)
      .mockResolvedValueOnce(
        response({ content: "Cut", stopReason: "length" }) as never,
      )
      .mockResolvedValue(response({ content: "off." }) as never);

    await ask({ runLimits: limits });

    const last: AILogRequest = request(
      spies.execute,
      spies.execute.mock.calls.length - 1,
    );
    const wrapUps: number = last.messages.filter((message: LLMMessage) => {
      return (
        message.role === "user" &&
        message.content ===
          AIAgentRunLimitsHelper.getWrapUpInstruction(
            AIRunStopReason.ToolCalls,
            limits,
          )
      );
    }).length;

    expect(wrapUps).toBe(1);
  });
});

describe("ObservabilityAssistant — loop detection", () => {
  test("a run reading what it has already seen is told to change course, then to answer", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 50,
      sameCallEveryTime: true,
    });

    const result: ObservabilityAssistantResult = await ask();

    // The first round is new; then a nudge after 3 rounds of nothing new, a stop after 5.
    expect(spies.toolbox).toHaveBeenCalledTimes(
      1 + NO_PROGRESS_ROUNDS_BEFORE_STOP,
    );

    const last: ModelCall = lastCall(calls);
    expect(last.hasTools).toBe(false);
    expect(
      last.messages.filter((message: LLMMessage): boolean => {
        return (
          message.role === "user" &&
          message.content ===
            `Your last ${NO_PROGRESS_ROUNDS_BEFORE_NUDGE} rounds of tool calls returned only results you had already seen. Do not repeat them: try a different approach, or answer with what you have.`
        );
      }),
    ).toHaveLength(1);
    expect(lastUserMessage(last.messages)).toBe(
      AIAgentRunLimitsHelper.getWrapUpInstruction(
        AIRunStopReason.Loop,
        AIAgentRunLimitsHelper.getDefault(),
      ),
    );
    expect(result.stopReason).toBe(AIRunStopReason.Loop);
    // Loop detection is no setting: the note says why, and links nothing.
    expect(result.stopNoteInMarkdown).toBe(
      "_This run stopped early: it kept repeating calls that showed it nothing new._",
    );
  });

  test(`the same call failing the same way ${REPEATED_FAILURE_LIMIT} times stops the run`, async () => {
    const spies: ReturnType<typeof installSpies> = installSpies({
      tool: (): ToolCallOutcome => {
        return failure("Error: the query timed out.");
      },
    });
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 50,
      sameCallEveryTime: true,
    });

    const result: ObservabilityAssistantResult = await ask();

    expect(spies.toolbox).toHaveBeenCalledTimes(REPEATED_FAILURE_LIMIT);
    expect(lastCall(calls).hasTools).toBe(false);
    expect(result.stopReason).toBe(AIRunStopReason.Loop);
  });

  test("a call made again that now returns something new is progress, never a loop", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies({
      tool: (_args: JSONObject, callNumber: number): ToolCallOutcome => {
        return outcome(`rollout: ${callNumber} of 30 pods updated`);
      },
    });
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 30,
      sameCallEveryTime: true,
    });

    const result: ObservabilityAssistantResult = await ask();

    expect(spies.toolbox).toHaveBeenCalledTimes(30);
    expect(
      calls.every((call: ModelCall): boolean => {
        return call.hasTools;
      }),
    ).toBe(true);
    expect(result.stopReason).toBeUndefined();
  });
});

describe("ObservabilityAssistant — where a run's limits come from", () => {
  test("a caller that passes its limits (an investigation's runner): the run reads none", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    fakeModel(spies.execute, { toolCallsNeeded: 1 });
    const read: jest.SpyInstance = jest.spyOn(AIRunLimitsReader, "read");
    const project: jest.SpyInstance = serveProject({ aiRunMaxToolCalls: 1 });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: AIAgentRunLimitsHelper.getDefault(),
    });

    expect(read).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(result.stopReason).toBeUndefined();
  });

  test("a Slack or Teams answer, handed no limits, reads the project's: its caps hold", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    const project: jest.SpyInstance = serveProject({ aiRunMaxToolCalls: 3 });
    const read: jest.SpyInstance = jest.spyOn(AIRunLimitsReader, "read");
    fakeModel(spies.execute, { toolCallsNeeded: 50 });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: undefined,
      chatApp: CHAT_APP,
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      isChatAppAnswer: true,
    });
    expect(project).toHaveBeenCalledTimes(1);
    expect(spies.toolbox).toHaveBeenCalledTimes(3);
    expect(result.stopReason).toBe(AIRunStopReason.ToolCalls);
    expect(result.stopNoteInMarkdown).toBe(
      `_This run stopped at this project's limit of 3 tool calls per run. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test("a Slack or Teams answer stops at the chat app's 25 minutes, though the project allows 60", async () => {
    useClock();
    const spies: ReturnType<typeof installSpies> = installSpies();
    serveProject({ aiRunTimeLimitInMinutes: 60 });
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 50,
      minutesPerCall: 10,
    });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: undefined,
      chatApp: CHAT_APP,
    });

    // At 10 and 20 minutes calls ran; the one asked for at 30 did not.
    expect(spies.toolbox).toHaveBeenCalledTimes(2);
    expect(lastUserMessage(lastCall(calls).messages)).toMatch(
      /^This run has reached its time limit of 25 minutes\. /,
    );
    expect(result.stopReason).toBe(AIRunStopReason.TimeLimit);
    // The chat app's window is no setting: nothing to change, and Ask AI goes on longer.
    expect(result.stopNoteInMarkdown).toBe(
      "_This answer stopped after 25 minutes, the longest a chat answer may take. Ask AI in the Dashboard can take longer._",
    );
  });

  test("a run handed no limits and no chat app reads the project's time limit, with no chat window", async () => {
    useClock();
    const spies: ReturnType<typeof installSpies> = installSpies();
    serveProject({ aiRunTimeLimitInMinutes: 60 });
    const read: jest.SpyInstance = jest.spyOn(AIRunLimitsReader, "read");
    fakeModel(spies.execute, { toolCallsNeeded: 50, minutesPerCall: 10 });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: undefined,
    });

    expect(read).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      isChatAppAnswer: false,
    });
    // Calls ran from 10 to 50 minutes; the one asked for at 60 did not.
    expect(spies.toolbox).toHaveBeenCalledTimes(5);
    expect(result.stopNoteInMarkdown).toBe(
      `_This run stopped at this project's time limit of 60 minutes per run. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test("a project that cannot be read leaves the run uncapped, with the default time limit", async () => {
    const spies: ReturnType<typeof installSpies> = installSpies();
    serveProject(new Error("connection refused"));
    const calls: Array<ModelCall> = fakeModel(spies.execute, {
      toolCallsNeeded: 40,
    });

    const result: ObservabilityAssistantResult = await ask({
      runLimits: undefined,
    });

    expect(spies.toolbox).toHaveBeenCalledTimes(40);
    expect(
      calls.every((call: ModelCall): boolean => {
        return call.hasTools;
      }),
    ).toBe(true);
    expect(result.stopReason).toBeUndefined();
  });
});

describe("ObservabilityAssistant — the model is never told about a budget", () => {
  test.each([
    {
      name: "no limit",
      limits: AIAgentRunLimitsHelper.getDefault(),
      model: { toolCallsNeeded: 12 },
    },
    {
      name: "a tool-call cap",
      limits: AIAgentRunLimitsHelper.fromSettings({ maxToolCalls: 2 }),
      model: { toolCallsNeeded: 12 },
    },
    {
      name: "a model-call cap",
      limits: AIAgentRunLimitsHelper.fromSettings({ maxModelCalls: 2 }),
      model: { toolCallsNeeded: 12 },
    },
    {
      name: "a token cap",
      limits: AIAgentRunLimitsHelper.fromSettings({ maxTokens: 1000 }),
      model: { toolCallsNeeded: 12, tokensPerCall: 400 },
    },
    {
      name: "a time limit",
      limits: AIAgentRunLimitsHelper.fromSettings({ timeLimitInMinutes: 5 }),
      model: { toolCallsNeeded: 12, minutesPerCall: 3 },
    },
    {
      name: "loop detection",
      limits: AIAgentRunLimitsHelper.getDefault(),
      model: { toolCallsNeeded: 12, sameCallEveryTime: true },
    },
  ])(
    "$name",
    async (data: {
      name: string;
      limits: AIAgentRunLimits;
      model: Parameters<typeof fakeModel>[1];
    }) => {
      useClock();
      const spies: ReturnType<typeof installSpies> = installSpies();
      const calls: Array<ModelCall> = fakeModel(spies.execute, data.model);

      const result: ObservabilityAssistantResult = await ask({
        runLimits: data.limits,
      });

      expect(calls.length).toBeGreaterThan(0);
      expect(everythingSent(calls)).not.toMatch(BUDGET);
      expect(result.stopNoteInMarkdown || "").not.toMatch(BUDGET);
    },
  );
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

    const result: ObservabilityAssistantResult = await ask();

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

    const result: ObservabilityAssistantResult = await ask();

    expect(spies.execute).toHaveBeenCalledTimes(MAX_ANSWER_CONTINUATIONS + 1);
    expect(result.contentInMarkdown).toContain("[part 1]");
    expect(result.contentInMarkdown).toContain(
      `[part ${MAX_ANSWER_CONTINUATIONS + 1}]`,
    );
    // No limit stopped it: no note.
    expect(result.stopReason).toBeUndefined();
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

      await ask();

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
        toolCallResponse(`call-${index}`, "run_kubectl", {
          command: `kubectl describe node node-${index}`,
        }) as never,
      );
    }
    spies.execute.mockResolvedValueOnce(
      response({ content: "Done." }) as never,
    );

    await ask({
      extraTools: [
        extraTool("run_kubectl", (args: JSONObject) => {
          return outcome(`${String(args["command"])}\n${huge}`);
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
    // Six different nodes: no loop, and nothing asked the model to stop.
    expect(last.tools).toBeDefined();
  });
});
