import ReplayInvestigation, {
  REPLAY_FEATURE,
  ReplayResult,
} from "../../../../../Server/Utils/AI/Eval/ReplayInvestigation";
import { PinnedModelCall } from "../../../../../Server/Utils/AI/Eval/PinnedModel";
import ObservabilityAssistant, {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
  ObservabilityAssistantRequest,
  ObservabilityAssistantResult,
  ObservabilityAssistantStep,
} from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { frameToolResult } from "../../../../../Server/Utils/AI/Chat/AgentContextCompactor";
import AIInvestigationEngine, {
  INVESTIGATION_PERSONA,
} from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import AIRunLimitsReader from "../../../../../Server/Utils/AI/AIRunLimitsReader";
import AIService from "../../../../../Server/Services/AIService";
import {
  LLMMessage,
  LLMToolDefinition,
} from "../../../../../Server/Utils/LLM/LLMService";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
} from "../../../../../Types/AI/AIAgentRunLimits";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import {
  AiContextActivity,
  composeAiContext,
} from "../../../../../Types/AI/AiContext";
import {
  INVESTIGATION_RECORDING_VERSION,
  InvestigationRecordedToolCall,
  InvestigationRecording,
  InvestigationRecordingInputs,
} from "../../../../../Types/AI/InvestigationRecording";
import { JSONObject } from "../../../../../Types/JSON";
import OneUptimeDate from "../../../../../Types/Date";
import ObjectID from "../../../../../Types/ObjectID";
import { INVESTIGATION_IMPACT_NUMBERS_LANGUAGE } from "../../../../../Utils/AI/InvestigationImpactNumbers";
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
 * AN OFFLINE REPLAY OF A RECORDED INVESTIGATION (issue #6800): today's
 * prompt, the model under test, and the evidence the original run saw. The
 * loop is the live one (ObservabilityAssistant.answerQuestion) - only its
 * transport is the replay's: the model calls go to the model under test,
 * every tool call is answered from the recording, and nothing reads the
 * project's data or bills it.
 *
 * Under test, with a scripted model: the prompt the model reads (the time
 * the original run started, the persona - a draft's, the recorded
 * override's, or today's - the recorded instructions, question and AI
 * context), the tools offered (the recorded extra tools among them, the
 * excluded ones not), each tool call answered as recorded (results,
 * failures, nearby times, and "no data" for a call never made), the counts
 * a report prints beside each grade, the impact numbers taken off the
 * analysis as a live run posts it, and the overrides a replay may take.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROMPT_TIME: string = "2026-11-10T08:30:00.000Z";
const MINUTE_MS: number = 60 * 1000;

const LOG_ARGS: JSONObject = {
  query: "checkout",
  startTime: "2026-11-10T07:30:00.000Z",
  endTime: "2026-11-10T08:30:00.000Z",
};
const METRIC_ARGS: JSONObject = {
  metricName: "db.pool.in_use",
  startTime: "2026-11-10T07:30:00.000Z",
  endTime: "2026-11-10T08:30:00.000Z",
};
const KUBECTL_ARGS: JSONObject = {
  clusterName: "prod-eu",
  command: "get pods -n checkout",
};

const LOG_TEXT: string =
  "3 rows: checkout-api could not get a connection from the pool";
const METRIC_ERROR: string =
  "Error: no metric named db.pool.in_use in this project.";
const KUBECTL_TEXT: string = "checkout-api-7d9 0/1 CrashLoopBackOff";

const KUBECTL_TOOL: LLMToolDefinition = {
  name: "run_kubectl",
  description:
    "Run a read-only kubectl command on a cluster this run may inspect.",
  inputSchema: {
    type: "object",
    properties: {
      clusterName: { type: "string" },
      command: { type: "string" },
    },
    required: ["clusterName", "command"],
  },
};

const REPORT: string = [
  "**Summary** — checkout requests queued for a database connection [C1].",
  "",
  "**Most likely root cause** — the pool was cut from 40 to 10, and the pods restarted [C2].",
].join("\n");

const IMPACT_BLOCK: string = [
  `\`\`\`${INVESTIGATION_IMPACT_NUMBERS_LANGUAGE}`,
  '{"users": {"count": 1240, "counted": "requests"}, "services": {"count": 2}}',
  "```",
].join("\n");

const NOT_RECORDED_TEXT: (toolName: string) => string = (
  toolName: string,
): string => {
  return `Error: no data is available for ${toolName} with these arguments in this run. Answer with the data you already have, or try a different call.`;
};

function recordedCalls(): Array<InvestigationRecordedToolCall> {
  return [
    {
      toolName: "search_logs",
      arguments: LOG_ARGS,
      success: true,
      text: LOG_TEXT,
      rowCount: 3,
      citationLabel: "Logs matching checkout",
      citationTarget: {
        type: AIChatCitationTargetType.Logs,
        params: { query: "checkout" },
      },
      isTruncated: false,
      durationMs: 120,
    },
    {
      toolName: "query_metrics",
      arguments: METRIC_ARGS,
      success: false,
      text: METRIC_ERROR,
      durationMs: 40,
    },
    {
      toolName: "run_kubectl",
      arguments: KUBECTL_ARGS,
      success: true,
      text: KUBECTL_TEXT,
      rowCount: 1,
      citationLabel: "kubectl get pods -n checkout",
      durationMs: 900,
    },
  ];
}

function recording(
  inputs: Partial<InvestigationRecordingInputs> = {},
  toolCalls: Array<InvestigationRecordedToolCall> = recordedCalls(),
): InvestigationRecording {
  return {
    version: INVESTIGATION_RECORDING_VERSION,
    inputs: {
      contextText:
        "# Incident\nTitle: Checkout returns 500s\nSeverity: Critical",
      aiContext: null,
      promptTime: PROMPT_TIME,
      runLimits: AIAgentRunLimitsHelper.getDefault(),
      maxOutputTokens: 4096,
      excludedToolNames: ["get_ai_investigation", "start_investigation"],
      extraTools: [KUBECTL_TOOL],
      providerName: "Anthropic",
      modelName: "claude-sonnet-5-5",
      ...inputs,
    },
    toolCalls,
    toolCallsNotKept: 0,
  };
}

interface ScriptedModel {
  callModel: PinnedModelCall;
  calls: Array<ObservabilityAssistantModelCall>;
}

// A model that answers each call with the next reply of its script.
function scriptedModel(
  replies: Array<ObservabilityAssistantModelReply>,
): ScriptedModel {
  const calls: Array<ObservabilityAssistantModelCall> = [];

  return {
    calls,
    callModel: async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      calls.push(call);

      const reply: ObservabilityAssistantModelReply | undefined =
        replies[calls.length - 1];

      if (!reply) {
        throw new Error(`The script has no reply for call ${calls.length}.`);
      }

      return reply;
    },
  };
}

function toolRound(
  toolCalls: Array<{ id: string; name: string; arguments: JSONObject }>,
): ObservabilityAssistantModelReply {
  return {
    content: "",
    toolCalls,
    stopReason: "tool_use",
    tokenCount: 1000,
    providerName: "Anthropic",
    modelName: "claude-opus-5-5",
  };
}

function answer(content: string): ObservabilityAssistantModelReply {
  return {
    content,
    stopReason: "stop",
    tokenCount: 300,
    providerName: "Anthropic",
    modelName: "claude-opus-5-5",
  };
}

// The model's usual investigation: the three recorded calls and one never made.
function usualModel(): ScriptedModel {
  return scriptedModel([
    toolRound([
      { id: "call_1", name: "search_logs", arguments: LOG_ARGS },
      { id: "call_2", name: "query_metrics", arguments: METRIC_ARGS },
      { id: "call_3", name: "run_kubectl", arguments: KUBECTL_ARGS },
      { id: "call_4", name: "get_trace", arguments: { traceId: "4bf92f35" } },
    ]),
    answer(`${REPORT}\n\n${IMPACT_BLOCK}`),
  ]);
}

function systemPromptOf(call: ObservabilityAssistantModelCall): string {
  expect(call.messages[0]!.role).toBe("system");
  return call.messages[0]!.content;
}

function questionOf(call: ObservabilityAssistantModelCall): string {
  const users: Array<LLMMessage> = call.messages.filter(
    (message: LLMMessage): boolean => {
      return message.role === "user";
    },
  );

  return users[0]!.content;
}

function toolNamesOf(call: ObservabilityAssistantModelCall): Array<string> {
  return (call.tools || []).map((tool: LLMToolDefinition): string => {
    return tool.name;
  });
}

function toolMessage(
  call: ObservabilityAssistantModelCall,
  toolCallId: string,
): string | undefined {
  return call.messages.find((message: LLMMessage): boolean => {
    return message.role === "tool" && message.toolCallId === toolCallId;
  })?.content;
}

async function replay(
  model: ScriptedModel,
  overrides: {
    recording?: InvestigationRecording | undefined;
    persona?: string | undefined;
    runLimits?: AIAgentRunLimits | undefined;
    maxOutputTokens?: number | undefined;
    onStep?: ((step: ObservabilityAssistantStep) => Promise<void>) | undefined;
  } = {},
): Promise<ReplayResult> {
  return ReplayInvestigation.replay({
    projectId: PROJECT_ID,
    recording: overrides.recording || recording(),
    callModel: model.callModel,
    persona: overrides.persona,
    runLimits: overrides.runLimits,
    maxOutputTokens: overrides.maxOutputTokens,
    onStep: overrides.onStep,
  });
}

describe("ReplayInvestigation.replay", () => {
  let executeWithLogging: SpyInstance<typeof AIService.executeWithLogging>;
  let executeTool: SpyInstance<typeof AIToolbox.executeTool>;
  let readAiContext: SpyInstance<typeof AiContextReader.read>;
  let readRunLimits: SpyInstance<typeof AIRunLimitsReader.read>;

  beforeEach(() => {
    executeWithLogging = jest.spyOn(AIService, "executeWithLogging");
    executeTool = jest.spyOn(AIToolbox, "executeTool");
    readAiContext = jest.spyOn(AiContextReader, "read");
    readRunLimits = jest.spyOn(AIRunLimitsReader, "read");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("answers every tool call from the recording: results, failures, and no data for a call never made", async () => {
    const model: ScriptedModel = usualModel();

    const result: ReplayResult = await replay(model);

    expect(model.calls).toHaveLength(2);

    const second: ObservabilityAssistantModelCall = model.calls[1]!;

    expect(toolMessage(second, "call_1")).toBe(
      frameToolResult({ citationId: "C1", rowCount: 3, text: LOG_TEXT }),
    );
    // A call that failed then fails now, with the error the model read then.
    expect(toolMessage(second, "call_2")).toBe(METRIC_ERROR);
    // A recorded extra tool is answered from the recording too.
    expect(toolMessage(second, "call_3")).toBe(
      frameToolResult({ citationId: "C2", rowCount: 1, text: KUBECTL_TEXT }),
    );
    expect(toolMessage(second, "call_4")).toBe(NOT_RECORDED_TEXT("get_trace"));

    expect(result.answers).toEqual({ exact: 3, nearbyTime: 0, notRecorded: 1 });
    expect(result.unrecordedToolCallCount).toBe(1);
  });

  test("never reads the project's data, its AI context or its limits, and never bills it", async () => {
    await replay(usualModel());

    expect(executeTool).not.toHaveBeenCalled();
    expect(executeWithLogging).not.toHaveBeenCalled();
    expect(readAiContext).not.toHaveBeenCalled();
    expect(readRunLimits).not.toHaveBeenCalled();
  });

  test("hands back the analysis as a live run posts it, its impact numbers taken off", async () => {
    const result: ReplayResult = await replay(usualModel());

    expect(result.analysisMarkdown).toBe(REPORT);
    expect(result.analysisMarkdown).not.toContain(
      INVESTIGATION_IMPACT_NUMBERS_LANGUAGE,
    );
  });

  test("the citations the replay minted, and the counts a report prints beside its grade", async () => {
    const result: ReplayResult = await replay(usualModel());

    expect(result.citations).toEqual([
      {
        id: "C1",
        toolName: "search_logs",
        label: "Logs matching checkout",
        queryArguments: LOG_ARGS,
        rowCount: 3,
        target: {
          type: AIChatCitationTargetType.Logs,
          params: { query: "checkout" },
        },
      },
      {
        id: "C2",
        toolName: "run_kubectl",
        label: "kubectl get pods -n checkout",
        queryArguments: KUBECTL_ARGS,
        rowCount: 1,
      },
    ]);
    expect(result.llmCallCount).toBe(2);
    expect(result.toolCallCount).toBe(4);
    expect(result.totalTokens).toBe(1300);
    // The model that answered, never the recorded run's.
    expect(result.providerName).toBe("Anthropic");
    expect(result.modelName).toBe("claude-opus-5-5");
    // No limit stopped it: no stop reason at all.
    expect(Object.keys(result)).not.toContain("stopReason");
  });

  test("the prompt names the time the original run started, so 'the last hour' means the hour it meant then", async () => {
    const model: ScriptedModel = usualModel();

    await replay(model);

    expect(systemPromptOf(model.calls[0]!)).toContain(
      `The current time is ${PROMPT_TIME}.`,
    );
  });

  test("a recording whose time cannot be read is replayed at today's time", async () => {
    const now: Date = new Date("2027-01-04T12:00:00.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
    const model: ScriptedModel = usualModel();

    await replay(model, {
      recording: recording({ promptTime: "not a time" }),
    });

    expect(systemPromptOf(model.calls[0]!)).toContain(
      "The current time is 2027-01-04T12:00:00.000Z.",
    );
  });

  test("asks what a live investigation asks: the engine's instructions and question, around the recorded context", async () => {
    const model: ScriptedModel = usualModel();
    const inputs: InvestigationRecordingInputs = recording().inputs;

    await replay(model);

    expect(
      systemPromptOf(model.calls[0]!).endsWith(
        `\n\n${AIInvestigationEngine.getSystemInstructions({
          persona: INVESTIGATION_PERSONA,
          hasAiContext: false,
        })}`,
      ),
    ).toBe(true);
    expect(questionOf(model.calls[0]!)).toBe(
      AIInvestigationEngine.getQuestion({ contextText: inputs.contextText }),
    );
    expect(questionOf(model.calls[0]!)).toContain(
      "Title: Checkout returns 500s",
    );
  });

  test("the recorded instructions and question are asked again", async () => {
    const model: ScriptedModel = usualModel();

    await replay(model, {
      recording: recording({
        additionalInstructions:
          "You may inspect the prod-eu cluster with kubectl; prod-us is not connected.",
        questionOverride: "Check this alert again: it fired a second time.",
      }),
    });

    expect(systemPromptOf(model.calls[0]!)).toContain(
      "You may inspect the prod-eu cluster with kubectl; prod-us is not connected.",
    );
    expect(questionOf(model.calls[0]!)).toBe(
      "Check this alert again: it fired a second time.\n\n# Incident\nTitle: Checkout returns 500s\nSeverity: Critical",
    );
  });

  test("the persona: a draft to try wins over the recorded run's override, which wins over today's", async () => {
    const opening: string = INVESTIGATION_PERSONA.substring(0, 120);

    const todays: ScriptedModel = usualModel();
    await replay(todays);
    expect(systemPromptOf(todays.calls[0]!)).toContain(opening);

    const recorded: ScriptedModel = usualModel();
    await replay(recorded, {
      recording: recording({
        personaOverride: "You are OneUptime AI, planning a remediation.",
      }),
    });
    expect(systemPromptOf(recorded.calls[0]!)).toContain(
      "You are OneUptime AI, planning a remediation.",
    );
    expect(systemPromptOf(recorded.calls[0]!)).not.toContain(opening);

    const draft: ScriptedModel = usualModel();
    await replay(draft, {
      recording: recording({
        personaOverride: "You are OneUptime AI, planning a remediation.",
      }),
      persona: "DRAFT PERSONA: investigate, then answer in five lines.",
    });
    expect(systemPromptOf(draft.calls[0]!)).toContain(
      "DRAFT PERSONA: investigate, then answer in five lines.",
    );
    expect(systemPromptOf(draft.calls[0]!)).not.toContain(
      "planning a remediation",
    );
    expect(systemPromptOf(draft.calls[0]!)).not.toContain(opening);
  });

  test("the recorded AI context comes first in the prompt, with the report's words for its languages", async () => {
    const aiContext: AiContextActivity = composeAiContext({
      projectContext: "Checkout runs on the payments-db Postgres cluster.",
    })!;
    const model: ScriptedModel = usualModel();

    await replay(model, { recording: recording({ aiContext }) });

    const systemPrompt: string = systemPromptOf(model.calls[0]!);

    expect(systemPrompt).toContain(
      "Checkout runs on the payments-db Postgres cluster.",
    );
    expect(
      systemPrompt.indexOf(
        "Checkout runs on the payments-db Postgres cluster.",
      ),
    ).toBeLessThan(systemPrompt.indexOf("The current time is"));
    expect(
      systemPrompt.endsWith(
        AIInvestigationEngine.getSystemInstructions({
          persona: INVESTIGATION_PERSONA,
          hasAiContext: true,
        }),
      ),
    ).toBe(true);
  });

  test("offers the toolbox and the recorded extra tools, never the excluded ones, at the recorded output limit", async () => {
    const model: ScriptedModel = usualModel();

    await replay(model);

    const first: ObservabilityAssistantModelCall = model.calls[0]!;
    const names: Array<string> = toolNamesOf(first);

    expect(names).toContain("search_logs");
    expect(names).toContain("query_metrics");
    expect(names).not.toContain("get_ai_investigation");
    expect(names).not.toContain("start_investigation");
    // Read-only: nothing that changes the project.
    expect(names).not.toContain("create_incident");
    expect(
      (first.tools || []).find((tool: LLMToolDefinition): boolean => {
        return tool.name === "run_kubectl";
      }),
    ).toEqual(KUBECTL_TOOL);
    expect(first.maxTokens).toBe(4096);
    // The loop's own temperature, as a live run's.
    expect(first.temperature).toBe(0.2);
  });

  test("an excluded tool the model names anyway is refused by the loop, and counted as nothing replayed", async () => {
    const model: ScriptedModel = scriptedModel([
      toolRound([
        { id: "call_1", name: "get_ai_investigation", arguments: {} },
      ]),
      answer(REPORT),
    ]);

    const result: ReplayResult = await replay(model);

    expect(toolMessage(model.calls[1]!, "call_1")).toBe(
      "Error: get_ai_investigation is not available in this run. Answer with the data you already have.",
    );
    expect(result.answers).toEqual({ exact: 0, nearbyTime: 0, notRecorded: 0 });
  });

  test("the same call a few minutes off gets the nearest recorded answer, counted apart", async () => {
    const shifted: JSONObject = {
      query: "checkout",
      startTime: new Date(
        Date.parse("2026-11-10T07:30:00.000Z") + 5 * MINUTE_MS,
      ).toISOString(),
      endTime: new Date(
        Date.parse("2026-11-10T08:30:00.000Z") + 5 * MINUTE_MS,
      ).toISOString(),
    };
    const model: ScriptedModel = scriptedModel([
      toolRound([{ id: "call_1", name: "search_logs", arguments: shifted }]),
      answer(REPORT),
    ]);

    const result: ReplayResult = await replay(model);

    expect(toolMessage(model.calls[1]!, "call_1")).toBe(
      frameToolResult({ citationId: "C1", rowCount: 3, text: LOG_TEXT }),
    );
    expect(result.answers).toEqual({ exact: 0, nearbyTime: 1, notRecorded: 0 });
    expect(result.unrecordedToolCallCount).toBe(0);
    // The citation names the call the replay made.
    expect(result.citations[0]!.queryArguments).toEqual(shifted);
  });

  test("a model that takes another path gets no data, and the count says the grade means less", async () => {
    const model: ScriptedModel = scriptedModel([
      toolRound([
        { id: "call_1", name: "search_logs", arguments: { query: "payments" } },
        {
          id: "call_2",
          name: "query_traces",
          arguments: { service: "checkout" },
        },
      ]),
      answer("I could not find the cause."),
    ]);

    const result: ReplayResult = await replay(model);

    expect(toolMessage(model.calls[1]!, "call_1")).toBe(
      NOT_RECORDED_TEXT("search_logs"),
    );
    expect(result.answers).toEqual({ exact: 0, nearbyTime: 0, notRecorded: 2 });
    expect(result.unrecordedToolCallCount).toBe(2);
    expect(result.citations).toEqual([]);
  });

  test("a call made more times than the original made it gets the last recorded answer again", async () => {
    const model: ScriptedModel = scriptedModel([
      toolRound([{ id: "call_1", name: "search_logs", arguments: LOG_ARGS }]),
      toolRound([{ id: "call_2", name: "search_logs", arguments: LOG_ARGS }]),
      answer(REPORT),
    ]);

    const result: ReplayResult = await replay(model);

    expect(toolMessage(model.calls[2]!, "call_2")).toBe(
      frameToolResult({ citationId: "C2", rowCount: 3, text: LOG_TEXT }),
    );
    expect(result.answers).toEqual({ exact: 2, nearbyTime: 0, notRecorded: 0 });
  });

  test("a recording with no tool calls answers every call with no data", async () => {
    const model: ScriptedModel = usualModel();

    const result: ReplayResult = await replay(model, {
      recording: recording({}, []),
    });

    expect(result.answers).toEqual({ exact: 0, nearbyTime: 0, notRecorded: 4 });
  });

  test("a stricter limit than the recorded one stops the replay where it says, and the result says which", async () => {
    const model: ScriptedModel = scriptedModel([
      toolRound([
        { id: "call_1", name: "search_logs", arguments: LOG_ARGS },
        { id: "call_2", name: "query_metrics", arguments: METRIC_ARGS },
      ]),
      answer(REPORT),
    ]);

    const result: ReplayResult = await replay(model, {
      runLimits: { ...AIAgentRunLimitsHelper.getDefault(), maxToolCalls: 1 },
    });

    expect(result.stopReason).toBe(AIRunStopReason.ToolCalls);
    expect(result.toolCallCount).toBe(1);
    expect(result.answers).toEqual({ exact: 1, nearbyTime: 0, notRecorded: 0 });
    expect(toolMessage(model.calls[1]!, "call_2")).toContain("Skipped:");
    // Told to answer with what it has: no tools on the last call.
    expect(model.calls[1]!.tools).toBeUndefined();
  });

  test("the recorded limits hold when none is given", async () => {
    const model: ScriptedModel = scriptedModel([
      toolRound([
        { id: "call_1", name: "search_logs", arguments: LOG_ARGS },
        { id: "call_2", name: "query_metrics", arguments: METRIC_ARGS },
      ]),
      answer(REPORT),
    ]);

    const result: ReplayResult = await replay(model, {
      recording: recording({
        runLimits: { ...AIAgentRunLimitsHelper.getDefault(), maxToolCalls: 1 },
      }),
    });

    expect(result.stopReason).toBe(AIRunStopReason.ToolCalls);
    expect(result.toolCallCount).toBe(1);
  });

  test("an output limit given wins over the recorded one", async () => {
    const model: ScriptedModel = usualModel();

    await replay(model, { maxOutputTokens: 2048 });

    expect(model.calls[0]!.maxTokens).toBe(2048);
  });

  test("tells each step as the live loop does, for a progress line", async () => {
    const steps: Array<ObservabilityAssistantStep["type"]> = [];

    await replay(usualModel(), {
      onStep: async (step: ObservabilityAssistantStep): Promise<void> => {
        steps.push(step.type);
      },
    });

    expect(steps[0]).toBe("llm_started");
    expect(steps).toContain("tool_completed");
    expect(steps).toContain("tool_failed");
    expect(steps[steps.length - 1]).toBe("llm_completed");
  });

  test("a model that fails fails the replay: the runner records that case's error", async () => {
    await expect(
      ReplayInvestigation.replay({
        projectId: PROJECT_ID,
        recording: recording(),
        callModel: async (): Promise<ObservabilityAssistantModelReply> => {
          throw new Error("401 Unauthorized");
        },
      }),
    ).rejects.toThrow("401 Unauthorized");
  });

  test("runs the live loop under its own feature label, as the system of the recorded project", async () => {
    const answerQuestion: SpyInstance<
      typeof ObservabilityAssistant.answerQuestion
    > = jest.spyOn(ObservabilityAssistant, "answerQuestion");

    await replay(usualModel());

    const request: ObservabilityAssistantRequest =
      answerQuestion.mock.calls[0]![0];

    expect(REPLAY_FEATURE).toBe("AI Investigation Replay");
    expect(request.feature).toBe(REPLAY_FEATURE);
    expect(request.projectId).toBe(PROJECT_ID);
    expect(request.props).toEqual({ isRoot: true, tenantId: PROJECT_ID });
    expect(request.aiContext).toBeNull();
    expect(request.excludeToolNames).toEqual([
      "get_ai_investigation",
      "start_investigation",
    ]);
    expect(request.currentTime).toEqual(new Date(PROMPT_TIME));
    expect(request.transport).toBeDefined();
    // Nothing a live run hands its owner: no recording, no AI Log.
    expect(request.onToolOutcome).toBeUndefined();
    expect(request.aiRunId).toBeUndefined();

    const result: ObservabilityAssistantResult = await (answerQuestion.mock
      .results[0]!.value as Promise<ObservabilityAssistantResult>);

    expect(result.llmCallCount).toBe(2);
  });
});
