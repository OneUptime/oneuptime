import AIInvestigationEngine, {
  AI_RUN_ATTEMPT_SEQUENCE_STRIDE,
  AI_RUN_ATTEMPT_SUPERSEDED_MESSAGE,
  AI_RUN_HEARTBEAT_INTERVAL_IN_MS,
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
  ObservabilityAssistantStep,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import LlmProviderChoice from "../../../../Server/Utils/AI/LlmProviderChoice";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import logger from "../../../../Server/Utils/Logger";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import {
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../../Types/AI/AIRunAttempt";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * An investigation's attempts (issue #6437: "Thinking keeps loading
 * forever"). What the run's activity is drawn from:
 *   (a) each attempt numbers its events in a block of its own, after every
 *       event before it, so a retried run's attempts never interleave;
 *   (b) a model call that fails ends its step (LlmCallFailed), so its
 *       Thinking never stays open;
 *   (c) an attempt that failed says how it ended (AttemptEnded), after its
 *       last step;
 *   (d) a running attempt says it is alive between its steps too, and one
 *       that finds its run moved on stops at its next step and writes
 *       nothing more.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type AssistantRequest = ObservabilityAssistantRequest;

function result(): ObservabilityAssistantResult {
  return {
    contentInMarkdown: "**Summary** — Checkout returned 500s.",
    citations: [],
    totalTokens: 100,
    llmCallCount: 1,
    toolCallCount: 0,
  };
}

function request(): InvestigationRequest {
  return {
    feature: "AI Incident Investigation",
    contextSummary: "# Incident\nTitle: Checkout is failing",
    postAnalysis: async (): Promise<void> => {
      return undefined;
    },
  };
}

// Let every promise already resolving settle.
function flush(): Promise<unknown> {
  return new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
}

describe("AIInvestigationEngine.getAttemptSequenceBase", () => {
  test.each([
    // A run with no events starts at 0.
    [0, 0],
    // After the first attempt's events, the next block.
    [1, AI_RUN_ATTEMPT_SEQUENCE_STRIDE],
    [37, AI_RUN_ATTEMPT_SEQUENCE_STRIDE],
    [AI_RUN_ATTEMPT_SEQUENCE_STRIDE, AI_RUN_ATTEMPT_SEQUENCE_STRIDE],
    // An event in the second block (the queue's AttemptEnded) moves it on.
    [AI_RUN_ATTEMPT_SEQUENCE_STRIDE + 1, 2 * AI_RUN_ATTEMPT_SEQUENCE_STRIDE],
    [
      2 * AI_RUN_ATTEMPT_SEQUENCE_STRIDE + 12,
      3 * AI_RUN_ATTEMPT_SEQUENCE_STRIDE,
    ],
    // Past the column's last block: right after the last event.
    [2000000001, 2000000001],
  ])(
    "after events up to %d, the attempt starts at %d",
    (sequenceAfterLastEvent: number, expected: number) => {
      expect(
        AIInvestigationEngine.getAttemptSequenceBase(sequenceAfterLastEvent),
      ).toBe(expected);
    },
  );

  test("every base fits the sequence column (a Postgres integer)", () => {
    for (const after of [1, 999999, 1999000001, 2000000000, 2100000000]) {
      expect(AIInvestigationEngine.getAttemptSequenceBase(after)).toBeLessThan(
        2147483647,
      );
    }
  });
});

describe("AIInvestigationEngine.executeRun: an attempt's events", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  let events: Array<AIRunEvent>;
  let heartbeats: number;
  let isRunOwned: boolean;
  let sequenceAfterLastEvent: jest.SpyInstance;
  let failedAttempt: jest.SpyInstance;
  let answer: (
    assistant: AssistantRequest,
  ) => Promise<ObservabilityAssistantResult>;

  async function executeRun(attemptCount: number = 1): Promise<void> {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount,
      request: request(),
    });
  }

  function eventTypes(): Array<AIRunEventType | undefined> {
    return events.map((event: AIRunEvent): AIRunEventType | undefined => {
      return event.eventType;
    });
  }

  beforeEach(() => {
    events = [];
    heartbeats = 0;
    isRunOwned = true;
    answer = async (): Promise<ObservabilityAssistantResult> => {
      return result();
    };

    sequenceAfterLastEvent = jest
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

        // A heartbeat keeps the run Running; completing it is no beat.
        if (set["status"] === AIRunStatus.Running && set["lastHeartbeatAt"]) {
          heartbeats++;
          return isRunOwned ? 1 : 0;
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
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockImplementation(
        async (
          assistant: AssistantRequest,
        ): Promise<ObservabilityAssistantResult> => {
          return answer(assistant);
        },
      );
    failedAttempt = jest
      .spyOn(AIInvestigationQueue, "failOrRequeueWithDetails")
      .mockResolvedValue({
        outcome: "requeued",
        attemptEnd: {
          outcome: AIRunAttemptOutcome.WillRetry,
          failureKind: AIRunFailureKind.ProviderTimeout,
          attempt: 1,
          maxAttempts: 3,
          nextAttemptAt: "2026-11-09T14:05:00.000Z",
          timeoutInSeconds: 120,
        },
      } as FailedAttemptResult);
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a run's first attempt numbers its events from 0", async () => {
    await executeRun();

    expect(events[0]!.eventType).toBe(AIRunEventType.RunStarted);
    expect(events[0]!.sequence).toBe(0);
  });

  test("a retried run's attempt numbers its events in the next block, after every earlier event", async () => {
    // The first attempt wrote 37 events (0..36).
    sequenceAfterLastEvent.mockResolvedValue(37);

    await executeRun(2);

    const sequences: Array<number> = events.map((event: AIRunEvent): number => {
      return event.sequence!;
    });

    expect(sequences[0]).toBe(AI_RUN_ATTEMPT_SEQUENCE_STRIDE);
    // In order, one after another.
    sequences.forEach((sequence: number, index: number) => {
      expect(sequence).toBe(AI_RUN_ATTEMPT_SEQUENCE_STRIDE + index);
    });
    expect(sequenceAfterLastEvent).toHaveBeenCalledWith(aiRunId);
  });

  test("a run whose last event cannot be read still runs, from 0", async () => {
    sequenceAfterLastEvent.mockRejectedValue(new Error("db down"));

    await executeRun();

    expect(events[0]!.eventType).toBe(AIRunEventType.RunStarted);
    expect(events[0]!.sequence).toBe(0);
    expect(eventTypes()).toContain(AIRunEventType.RunCompleted);
  });

  test("a model call that failed ends its step, with what went wrong", async () => {
    answer = async (
      assistant: AssistantRequest,
    ): Promise<ObservabilityAssistantResult> => {
      await assistant.onStep!({
        type: "llm_started",
      } as ObservabilityAssistantStep);
      await assistant.onStep!({
        type: "llm_failed",
        errorMessage: "the LLM provider did not respond within 120 seconds",
      } as ObservabilityAssistantStep);
      throw new Error(
        "OpenAICompatible API request failed: the LLM provider did not respond within 120 seconds.",
      );
    };

    await executeRun();

    expect(eventTypes()).toEqual([
      AIRunEventType.RunStarted,
      AIRunEventType.LlmCallStarted,
      AIRunEventType.LlmCallFailed,
      AIRunEventType.AttemptEnded,
    ]);
    expect(events[2]!.resultSummary?.errorMessage).toBe(
      "the LLM provider did not respond within 120 seconds",
    );
  });

  test("an attempt that failed and was requeued says how it ended, after its last step", async () => {
    answer = async (
      assistant: AssistantRequest,
    ): Promise<ObservabilityAssistantResult> => {
      await assistant.onStep!({
        type: "tool_started",
        toolName: "search_logs",
      } as ObservabilityAssistantStep);
      throw new Error("the LLM provider did not respond in time");
    };

    await executeRun();

    const attemptEnded: AIRunEvent = events[events.length - 1]!;
    expect(attemptEnded.eventType).toBe(AIRunEventType.AttemptEnded);
    expect(attemptEnded.resultSummary?.attemptEnd).toEqual({
      outcome: AIRunAttemptOutcome.WillRetry,
      failureKind: AIRunFailureKind.ProviderTimeout,
      attempt: 1,
      maxAttempts: 3,
      nextAttemptAt: "2026-11-09T14:05:00.000Z",
      timeoutInSeconds: 120,
    });
    expect(attemptEnded.resultSummary?.errorMessage).toBe(
      "the LLM provider did not respond in time",
    );
    expect(eventTypes()).not.toContain(AIRunEventType.RunFailed);
  });

  test("a long error is kept to 400 characters on the activity", async () => {
    answer = async (): Promise<ObservabilityAssistantResult> => {
      throw new Error(`timed out ${"x".repeat(2000)}`);
    };

    await executeRun();

    const attemptEnded: AIRunEvent = events[events.length - 1]!;
    expect(attemptEnded.resultSummary?.errorMessage).toHaveLength(400);
  });

  test("every step it writes keeps the run alive", async () => {
    answer = async (
      assistant: AssistantRequest,
    ): Promise<ObservabilityAssistantResult> => {
      await assistant.onStep!({
        type: "llm_started",
      } as ObservabilityAssistantStep);
      await assistant.onStep!({
        type: "llm_completed",
      } as ObservabilityAssistantStep);
      return result();
    };

    await executeRun();

    expect(heartbeats).toBe(2);
  });

  test("between its steps too: one slow model call no longer outlasts the stale sweep", async () => {
    const setIntervalSpy: jest.SpyInstance = jest.spyOn(global, "setInterval");
    const clearIntervalSpy: jest.SpyInstance = jest.spyOn(
      global,
      "clearInterval",
    );

    answer = async (): Promise<ObservabilityAssistantResult> => {
      // The model takes its time: the interval's beat is what fires.
      const beat: Array<unknown> | undefined = setIntervalSpy.mock.calls.find(
        (call: Array<unknown>): boolean => {
          return call[1] === AI_RUN_HEARTBEAT_INTERVAL_IN_MS;
        },
      );
      expect(beat).toBeDefined();
      (beat![0] as () => void)();
      (beat![0] as () => void)();
      await flush();
      expect(heartbeats).toBe(2);
      return result();
    };

    await executeRun();

    // And it stops beating once the attempt is over.
    const beatIndex: number = setIntervalSpy.mock.calls.findIndex(
      (call: Array<unknown>): boolean => {
        return call[1] === AI_RUN_HEARTBEAT_INTERVAL_IN_MS;
      },
    );
    expect(clearIntervalSpy).toHaveBeenCalledWith(
      setIntervalSpy.mock.results[beatIndex]!.value,
    );
  });

  test("it stops beating when the attempt fails, too", async () => {
    const setIntervalSpy: jest.SpyInstance = jest.spyOn(global, "setInterval");
    const clearIntervalSpy: jest.SpyInstance = jest.spyOn(
      global,
      "clearInterval",
    );
    answer = async (): Promise<ObservabilityAssistantResult> => {
      throw new Error("the LLM provider did not respond in time");
    };

    await executeRun();

    const beatIndex: number = setIntervalSpy.mock.calls.findIndex(
      (call: Array<unknown>): boolean => {
        return call[1] === AI_RUN_HEARTBEAT_INTERVAL_IN_MS;
      },
    );
    expect(beatIndex).toBeGreaterThanOrEqual(0);
    expect(clearIntervalSpy).toHaveBeenCalledWith(
      setIntervalSpy.mock.results[beatIndex]!.value,
    );
  });

  test("an attempt whose run moved on stops at its next step, and writes nothing more", async () => {
    let stopReasonAfterLoss: string | null | undefined = undefined;

    answer = async (
      assistant: AssistantRequest,
    ): Promise<ObservabilityAssistantResult> => {
      expect(assistant.getStopReason!()).toBeNull();

      // The stale sweep requeued the run while this attempt worked.
      isRunOwned = false;
      await assistant.onStep!({
        type: "llm_started",
      } as ObservabilityAssistantStep);

      stopReasonAfterLoss = assistant.getStopReason!();

      // A step it still reports is not written among the next attempt's.
      await assistant.onStep!({
        type: "tool_started",
        toolName: "search_logs",
      } as ObservabilityAssistantStep);

      throw new Error(stopReasonAfterLoss || "stopped");
    };
    failedAttempt.mockResolvedValue({
      outcome: "noop",
      attemptEnd: { outcome: AIRunAttemptOutcome.GaveUp },
    } as FailedAttemptResult);

    await executeRun();

    expect(stopReasonAfterLoss).toBe(AI_RUN_ATTEMPT_SUPERSEDED_MESSAGE);
    expect(eventTypes()).toEqual([
      AIRunEventType.RunStarted,
      AIRunEventType.LlmCallStarted,
    ]);
    // Nor says how the attempt ended: whoever moved the run on says that.
    expect(eventTypes()).not.toContain(AIRunEventType.AttemptEnded);
    expect(eventTypes()).not.toContain(AIRunEventType.RunFailed);
  });

  test("a heartbeat that cannot be written is no proof the run moved on", async () => {
    jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockImplementation(async (data: unknown): Promise<number> => {
        const set: Record<string, unknown> = (
          data as { set: Record<string, unknown> }
        ).set;

        // A heartbeat keeps the run Running; completing it is no beat.
        if (set["status"] === AIRunStatus.Running && set["lastHeartbeatAt"]) {
          throw new Error("db down");
        }

        return 1;
      });

    let stopReason: string | null | undefined = undefined;
    answer = async (
      assistant: AssistantRequest,
    ): Promise<ObservabilityAssistantResult> => {
      await assistant.onStep!({
        type: "llm_started",
      } as ObservabilityAssistantStep);
      stopReason = assistant.getStopReason!();
      await assistant.onStep!({
        type: "llm_completed",
      } as ObservabilityAssistantStep);
      return result();
    };

    await executeRun();

    expect(stopReason).toBeNull();
    expect(eventTypes()).toContain(AIRunEventType.LlmCallCompleted);
    expect(eventTypes()).toContain(AIRunEventType.RunCompleted);
  });

  test("the error the attempt failed with goes to the queue with its message", async () => {
    const providerError: Error = new Error("socket hang up");
    answer = async (): Promise<ObservabilityAssistantResult> => {
      throw providerError;
    };

    await executeRun(2);

    expect(failedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId,
        attemptCount: 2,
        errorMessage: "socket hang up",
        isPermanent: false,
        error: providerError,
      }),
    );
  });
});
