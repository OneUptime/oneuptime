import AIInvestigationEngine, {
  INVESTIGATION_PERSONA,
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue, {
  FailedAttemptResult,
} from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIConfidenceSignal from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import InvestigationTldr from "../../../../Server/Utils/AI/SRE/InvestigationTldr";
import ObservabilityAssistant, {
  ObservabilityAssistantRequest,
  ObservabilityAssistantResult,
  ObservabilityAssistantToolOutcome,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import ReplayInvestigation from "../../../../Server/Utils/AI/Eval/ReplayInvestigation";
import LlmProviderChoice from "../../../../Server/Utils/AI/LlmProviderChoice";
import AiContextReader from "../../../../Server/Utils/AI/AiContext/AiContextReader";
import AIRunLimitsReader from "../../../../Server/Utils/AI/AIRunLimitsReader";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunRecordingService from "../../../../Server/Services/AIRunRecordingService";
import AIRunService from "../../../../Server/Services/AIRunService";
import logger from "../../../../Server/Utils/Logger";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
} from "../../../../Types/AI/AIAgentRunLimits";
import {
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../../Types/AI/AIRunAttempt";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import {
  AiContextActivity,
  composeAiContext,
} from "../../../../Types/AI/AiContext";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  INVESTIGATION_RECORDING_MAX_TOOL_CALLS,
  INVESTIGATION_RECORDING_VERSION,
  InvestigationRecording,
} from "../../../../Types/AI/InvestigationRecording";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PromptText from "../../../../Utils/AI/PromptText";
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
 * AN INVESTIGATION KEEPS WHAT IT SAW, FOR A REPLAY (issue #6800).
 *
 * A run whose runner asks for it (recordForReplay - the incident and alert
 * investigations) records every tool call the loop ran and what the model
 * was handed back, and once its attempt has completed the run, keeps that
 * with everything else the prompt was made of - the starting context, the
 * instructions, the AI context, the time the prompt named as now, the
 * limits, the excluded and extra tools, the model that answered - as an
 * AIRunRecording, so the run can be replayed on the same data after a
 * prompt or model change.
 *
 * Under test, with the engine's reads and writes replaced: what is kept and
 * when; nothing kept for a run that did not ask, for an attempt that lost
 * its run or failed; a recording that cannot be written never fails the
 * investigation; and a kept recording replays to the very request the live
 * run made.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const CONTEXT_SUMMARY: string =
  "# Incident\nTitle: Checkout returns 500s\nSeverity: Critical";

const LIMITS: AIAgentRunLimits = {
  ...AIAgentRunLimitsHelper.getDefault(),
  maxToolCalls: 40,
};

const KUBECTL_TOOL: {
  name: string;
  description: string;
  inputSchema: JSONObject;
} = {
  name: "run_kubectl",
  description: "Run a read-only kubectl command.",
  inputSchema: {
    type: "object",
    properties: { command: { type: "string" } },
  },
};

const LOG_OUTCOME: ObservabilityAssistantToolOutcome = {
  toolName: "search_logs",
  toolArguments: { query: "checkout", limit: 50 },
  success: true,
  textForLlm: "3 rows: checkout-api could not get a connection",
  rowCount: 3,
  citationLabel: "Logs matching checkout",
  citationTarget: {
    type: AIChatCitationTargetType.Logs,
    params: { query: "checkout" },
  },
  isTruncated: false,
  durationMs: 120,
};

const METRIC_OUTCOME: ObservabilityAssistantToolOutcome = {
  toolName: "query_metrics",
  toolArguments: { metricName: "db.pool.in_use" },
  success: false,
  textForLlm: "Error: no metric named db.pool.in_use.",
  durationMs: 40,
};

function result(): ObservabilityAssistantResult {
  return {
    contentInMarkdown: "**Summary** — the pool ran dry [C1].",
    citations: [],
    totalTokens: 1300,
    llmCallCount: 2,
    toolCallCount: 2,
    providerName: "Anthropic",
    modelName: "claude-sonnet-5-5",
  };
}

describe("AIInvestigationEngine.executeRun: what an investigation keeps for a replay", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  let order: Array<string>;
  let events: Array<AIRunEvent>;
  let assistantRequests: Array<ObservabilityAssistantRequest>;
  let outcomesToTell: Array<ObservabilityAssistantToolOutcome>;
  let isCompletionWon: boolean;
  let answer: () => Promise<ObservabilityAssistantResult>;
  let aiContext: AiContextActivity | null;
  let saveForRun: SpyInstance<typeof AIRunRecordingService.saveForRun>;
  let failOrRequeue: SpyInstance<
    typeof AIInvestigationQueue.failOrRequeueWithDetails
  >;
  let readRunLimits: SpyInstance<typeof AIRunLimitsReader.read>;
  let loggedErrors: Array<string>;

  function request(
    overrides: Partial<InvestigationRequest> = {},
  ): InvestigationRequest {
    return {
      feature: "AI Incident Investigation",
      incidentId: INCIDENT_ID,
      contextSummary: CONTEXT_SUMMARY,
      runLimits: LIMITS,
      recordForReplay: true,
      postAnalysis: async (): Promise<void> => {
        order.push("posted");
      },
      ...overrides,
    };
  }

  async function run(
    overrides: Partial<InvestigationRequest> = {},
  ): Promise<void> {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request(overrides),
    });
  }

  function saved(): {
    projectId: ObjectID;
    aiRunId: ObjectID;
    recording: InvestigationRecording;
  } {
    expect(saveForRun).toHaveBeenCalledTimes(1);
    return saveForRun.mock.calls[0]![0];
  }

  beforeEach(() => {
    order = [];
    events = [];
    assistantRequests = [];
    outcomesToTell = [LOG_OUTCOME, METRIC_OUTCOME];
    isCompletionWon = true;
    aiContext = null;
    loggedErrors = [];
    answer = async (): Promise<ObservabilityAssistantResult> => {
      return result();
    };

    jest
      .spyOn(AIRunEventService, "getSequenceAfterLastEvent")
      .mockResolvedValue(0);
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (data: unknown) => {
        const event: AIRunEvent = (data as { data: AIRunEvent }).data;
        events.push(event);
        return event;
      });
    jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockImplementation(async (data: unknown): Promise<number> => {
        const set: Record<string, unknown> = (
          data as { set: Record<string, unknown> }
        ).set;

        if (set["status"] === AIRunStatus.Completed) {
          order.push(isCompletionWon ? "completed" : "completion lost");
          return isCompletionWon ? 1 : 0;
        }

        return 1;
      });
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1);
    jest
      .spyOn(AIRunService, "finalizeInvestigationCodeFixRecommendation")
      .mockResolvedValue(1);
    jest.spyOn(InvestigationTldr, "generateTldr").mockResolvedValue(null);
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: true,
        source: "classification",
        codeFixRecommended: false,
      });
    jest.spyOn(LlmProviderChoice, "decideForRun").mockResolvedValue({
      provider: null,
      source: null,
      fallbackReason: null,
      pickedProviderId: "",
      activity: null,
    });
    jest
      .spyOn(AiContextReader, "read")
      .mockImplementation(async (): Promise<AiContextActivity | null> => {
        return aiContext;
      });
    readRunLimits = jest
      .spyOn(AIRunLimitsReader, "read")
      .mockResolvedValue(AIAgentRunLimitsHelper.getDefault());
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockImplementation(
        async (
          assistant: ObservabilityAssistantRequest,
        ): Promise<ObservabilityAssistantResult> => {
          assistantRequests.push(assistant);

          for (const outcome of outcomesToTell) {
            assistant.onToolOutcome?.(outcome);
          }

          return answer();
        },
      );
    saveForRun = jest
      .spyOn(AIRunRecordingService, "saveForRun")
      .mockImplementation(async (): Promise<void> => {
        order.push("saved");
      });
    failOrRequeue = jest
      .spyOn(AIInvestigationQueue, "failOrRequeueWithDetails")
      .mockResolvedValue({
        outcome: "requeued",
        attemptEnd: {
          outcome: AIRunAttemptOutcome.WillRetry,
          failureKind: AIRunFailureKind.ProviderTimeout,
          attempt: 1,
          maxAttempts: 3,
          nextAttemptAt: "2026-11-10T08:35:00.000Z",
          timeoutInSeconds: 120,
        },
      } as FailedAttemptResult);
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      loggedErrors.push(String(message));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("keeps the run's tool calls, as the model read them, for the run and its project", async () => {
    await run();

    const kept: {
      projectId: ObjectID;
      aiRunId: ObjectID;
      recording: InvestigationRecording;
    } = saved();

    expect(kept.projectId).toBe(PROJECT_ID);
    expect(kept.aiRunId).toBe(aiRunId);
    expect(kept.recording.version).toBe(INVESTIGATION_RECORDING_VERSION);
    expect(kept.recording.toolCalls).toEqual([
      {
        toolName: "search_logs",
        arguments: { query: "checkout", limit: 50 },
        success: true,
        text: "3 rows: checkout-api could not get a connection",
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
        arguments: { metricName: "db.pool.in_use" },
        success: false,
        text: "Error: no metric named db.pool.in_use.",
        durationMs: 40,
      },
    ]);
    expect(kept.recording.toolCallsNotKept).toBe(0);
  });

  test("keeps what the prompt was made of: the context, the time it named, the limits, the tools and the model", async () => {
    await run({
      extraTools: [{ definition: KUBECTL_TOOL, execute: jest.fn() as never }],
    });

    const assistant: ObservabilityAssistantRequest = assistantRequests[0]!;

    expect(saved().recording.inputs).toEqual({
      contextText: CONTEXT_SUMMARY,
      aiContext: null,
      // The very time the live prompt named as now.
      promptTime: assistant.currentTime!.toISOString(),
      runLimits: LIMITS,
      maxOutputTokens: 4096,
      excludedToolNames: ["get_ai_investigation", "start_investigation"],
      extraTools: [KUBECTL_TOOL],
      providerName: "Anthropic",
      modelName: "claude-sonnet-5-5",
    });
    expect(assistant.excludeToolNames).toEqual(
      saved().recording.inputs.excludedToolNames,
    );
    expect(assistant.runLimits).toBe(LIMITS);
  });

  test("keeps the instructions, persona and question a runner gave, and the AI context the run read", async () => {
    aiContext = composeAiContext({
      projectContext: "Checkout runs on the payments-db Postgres cluster.",
    });

    await run({
      additionalInstructions: "You may inspect the prod-eu cluster.",
      personaOverride: "You are OneUptime AI, checking a record again.",
      questionOverride: "Check this incident again.",
      maxOutputTokens: 2048,
    });

    const inputs: InvestigationRecording["inputs"] = saved().recording.inputs;

    expect(inputs.additionalInstructions).toBe(
      "You may inspect the prod-eu cluster.",
    );
    expect(inputs.personaOverride).toBe(
      "You are OneUptime AI, checking a record again.",
    );
    expect(inputs.questionOverride).toBe("Check this incident again.");
    expect(inputs.aiContext).toEqual(aiContext);
    expect(inputs.maxOutputTokens).toBe(2048);
  });

  test("names only what the run had: no instructions, persona, question, provider or model it was not given", async () => {
    answer = async (): Promise<ObservabilityAssistantResult> => {
      return {
        ...result(),
        providerName: undefined,
        modelName: undefined,
      };
    };

    await run({ additionalInstructions: "" });

    expect(Object.keys(saved().recording.inputs).sort()).toEqual([
      "aiContext",
      "contextText",
      "excludedToolNames",
      "extraTools",
      "maxOutputTokens",
      "promptTime",
      "runLimits",
    ]);
  });

  test("an empty question override is the question the run asked, and is kept as such", async () => {
    await run({ questionOverride: "" });

    expect(saved().recording.inputs.questionOverride).toBe("");
    expect(assistantRequests[0]!.question).toBe(`\n\n${CONTEXT_SUMMARY}`);
  });

  test("the context is kept as the model read it: embedded data left out", async () => {
    const image: string = `data:image/png;base64,${"iVBORw0KGgo".repeat(400)}`;
    const summary: string = `${CONTEXT_SUMMARY}\nScreenshot: ${image}`;

    await run({ contextSummary: summary });

    const contextText: string = saved().recording.inputs.contextText;

    expect(contextText).toBe(PromptText.omitEmbeddedData(summary).text);
    expect(contextText).not.toContain("base64,");
    expect(assistantRequests[0]!.question).toContain(contextText);
  });

  test("the limits the run read, when its runner gave none", async () => {
    const projectLimits: AIAgentRunLimits = {
      ...AIAgentRunLimitsHelper.getDefault(),
      maxLlmCalls: 12,
    };
    readRunLimits.mockResolvedValue(projectLimits);

    await run({ runLimits: undefined });

    expect(saved().recording.inputs.runLimits).toEqual(projectLimits);
  });

  test("kept once the attempt has completed the run, never before", async () => {
    await run();

    expect(order.indexOf("completed")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("saved")).toBeGreaterThan(order.indexOf("completed"));
    expect(order).toContain("posted");
  });

  test("a run that did not ask keeps nothing, and its loop is told no outcome to record", async () => {
    for (const recordForReplay of [undefined, false]) {
      assistantRequests = [];

      await run({ recordForReplay });

      expect(assistantRequests[0]!.onToolOutcome).toBeUndefined();
    }

    expect(saveForRun).not.toHaveBeenCalled();
  });

  test("an attempt that lost its run keeps nothing: the attempt that completes it keeps its own", async () => {
    isCompletionWon = false;

    await run();

    expect(order).toEqual(["completion lost"]);
    expect(saveForRun).not.toHaveBeenCalled();
  });

  test("an attempt that failed keeps nothing", async () => {
    answer = async (): Promise<ObservabilityAssistantResult> => {
      throw new Error("503 Service Unavailable");
    };

    await run();

    expect(failOrRequeue).toHaveBeenCalledTimes(1);
    expect(saveForRun).not.toHaveBeenCalled();
  });

  test("a recording that cannot be written never fails the investigation: the report is posted and the run completes", async () => {
    saveForRun.mockRejectedValue(new Error("value too long for type jsonb"));

    await run();

    expect(order).toContain("posted");
    expect(failOrRequeue).not.toHaveBeenCalled();
    expect(
      events.map((event: AIRunEvent) => {
        return event.eventType;
      }),
    ).toContain(AIRunEventType.RunCompleted);
    expect(
      events.map((event: AIRunEvent) => {
        return event.eventType;
      }),
    ).not.toContain(AIRunEventType.RunFailed);
    expect(
      loggedErrors.filter((message: string): boolean => {
        return message.includes("for a replay");
      }),
    ).toEqual([
      `AI: failed to keep what run ${aiRunId.toString()} saw for a replay: Error: value too long for type jsonb`,
    ]);
  });

  test("the recording's own caps hold: a run past its most tool calls keeps the first ones and counts the rest", async () => {
    outcomesToTell = [];

    for (
      let index: number = 0;
      index < INVESTIGATION_RECORDING_MAX_TOOL_CALLS + 2;
      index++
    ) {
      outcomesToTell.push({
        ...LOG_OUTCOME,
        toolArguments: { query: `q${index}` },
      });
    }

    await run();

    const kept: InvestigationRecording = saved().recording;

    expect(kept.toolCalls).toHaveLength(INVESTIGATION_RECORDING_MAX_TOOL_CALLS);
    expect(kept.toolCallsNotKept).toBe(2);
    expect(kept.toolCalls[0]!.arguments).toEqual({ query: "q0" });
  });

  test("each run keeps its own: a second run's recording holds none of the first's calls", async () => {
    await run();
    outcomesToTell = [METRIC_OUTCOME];
    await run();

    expect(saveForRun).toHaveBeenCalledTimes(2);
    expect(saveForRun.mock.calls[1]![0].recording.toolCalls).toHaveLength(1);
  });
});

describe("a kept recording replays to the request the live run made", () => {
  const aiRunId: ObjectID = ObjectID.generate();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ["today's persona, no AI context", {}, null],
    [
      "a runner's persona, instructions and question, with an AI context",
      {
        personaOverride: "You are OneUptime AI, checking a record again.",
        additionalInstructions: "You may inspect the prod-eu cluster.",
        questionOverride: "Check this incident again.",
      },
      "Checkout runs on the payments-db Postgres cluster.",
    ],
  ])(
    "%s",
    async (
      _name: string,
      overrides: Partial<InvestigationRequest>,
      projectContext: string | null,
    ) => {
      const liveRequests: Array<ObservabilityAssistantRequest> = [];
      const kept: Array<InvestigationRecording> = [];
      const readContext: AiContextActivity | null = projectContext
        ? composeAiContext({ projectContext })
        : null;

      jest
        .spyOn(AIRunEventService, "getSequenceAfterLastEvent")
        .mockResolvedValue(0);
      jest
        .spyOn(AIRunEventService, "create")
        .mockImplementation(async (data: unknown) => {
          return (data as { data: AIRunEvent }).data;
        });
      jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
      jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1);
      jest.spyOn(InvestigationTldr, "generateTldr").mockResolvedValue(null);
      jest
        .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
        .mockResolvedValue({
          confident: true,
          source: "classification",
          codeFixRecommended: false,
        });
      jest.spyOn(LlmProviderChoice, "decideForRun").mockResolvedValue({
        provider: null,
        source: null,
        fallbackReason: null,
        pickedProviderId: "",
        activity: null,
      });
      jest.spyOn(AiContextReader, "read").mockResolvedValue(readContext);
      jest
        .spyOn(AIRunRecordingService, "saveForRun")
        .mockImplementation(
          async (data: {
            recording: InvestigationRecording;
          }): Promise<void> => {
            // As stored: JSON, and read back.
            kept.push(JSON.parse(JSON.stringify(data.recording)));
          },
        );
      jest.spyOn(logger, "debug").mockImplementation((): void => {});
      const answerQuestion: SpyInstance<
        typeof ObservabilityAssistant.answerQuestion
      > = jest
        .spyOn(ObservabilityAssistant, "answerQuestion")
        .mockImplementation(
          async (
            assistant: ObservabilityAssistantRequest,
          ): Promise<ObservabilityAssistantResult> => {
            liveRequests.push(assistant);
            assistant.onToolOutcome?.(LOG_OUTCOME);
            return result();
          },
        );

      await AIInvestigationEngine.executeRun({
        aiRunId,
        projectId: PROJECT_ID,
        attemptCount: 1,
        request: {
          feature: "AI Incident Investigation",
          incidentId: INCIDENT_ID,
          contextSummary: CONTEXT_SUMMARY,
          runLimits: LIMITS,
          recordForReplay: true,
          extraTools: [
            { definition: KUBECTL_TOOL, execute: jest.fn() as never },
          ],
          postAnalysis: async (): Promise<void> => {
            return undefined;
          },
          ...overrides,
        },
      });

      expect(kept).toHaveLength(1);

      await ReplayInvestigation.replay({
        projectId: PROJECT_ID,
        recording: kept[0]!,
        callModel: jest.fn() as never,
      });

      expect(answerQuestion).toHaveBeenCalledTimes(2);

      const live: ObservabilityAssistantRequest = liveRequests[0]!;
      const replayed: ObservabilityAssistantRequest =
        answerQuestion.mock.calls[1]![0];

      expect(replayed.systemInstructions).toBe(live.systemInstructions);
      expect(replayed.question).toBe(live.question);
      expect(replayed.currentTime).toEqual(live.currentTime);
      expect(replayed.runLimits).toEqual(live.runLimits);
      expect(replayed.maxOutputTokens).toBe(live.maxOutputTokens);
      expect(replayed.excludeToolNames).toEqual(live.excludeToolNames);
      expect(replayed.aiContext).toEqual(live.aiContext);
      expect(
        (replayed.extraTools || []).map((tool: { definition: unknown }) => {
          return tool.definition;
        }),
      ).toEqual(
        (live.extraTools || []).map((tool: { definition: unknown }) => {
          return tool.definition;
        }),
      );
      // The live persona is the replay's, unless a draft is tried.
      expect(live.systemInstructions).toContain(
        overrides.personaOverride ?? INVESTIGATION_PERSONA,
      );
    },
  );
});
