import AIInvestigationQueue, {
  MAX_INVESTIGATION_ATTEMPTS,
} from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import RemediationHandoff from "../../../../Server/Utils/AI/SRE/RemediationHandoff";
import AIConfidenceSignal from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import InvestigationTldr from "../../../../Server/Utils/AI/SRE/InvestigationTldr";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunCodeFixRecommendation from "../../../../Types/AI/AIRunCodeFixRecommendation";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * RCA-first ordering — the settle-once discipline. Auto-remediation for an
 * incident/alert is DEFERRED while an investigation is in flight, so every
 * terminal outcome must release the subject exactly once, and non-terminal
 * outcomes (a requeue, a lost CAS) must NOT:
 *   (a) failOrRequeue reports what actually happened ("requeued" /
 *       "finalized" / "noop") so its callers can settle exactly once;
 *   (b) the stale sweeper and the queue-TTL expiry hand a terminally-dead
 *       incident/alert Investigation to RemediationHandoff — and ONLY when
 *       they WON the terminal transition, ONLY for that run shape;
 *   (c) the engine fires InvestigationRequest.onSettled on every terminal
 *       path this attempt owns (Completed with/without analysis, Completed
 *       then postAnalysis failed, finalized Error) and never on a requeue,
 *       a lost CAS, or as an exception out of executeRun.
 */

/*
 * The queue lazy-requires RemediationHandoff (circular-import avoidance), so
 * the module itself is mocked — the require cache hands back this stub.
 */
jest.mock("../../../../Server/Utils/AI/SRE/RemediationHandoff", () => {
  return {
    __esModule: true,
    default: {
      runForSettledInvestigation: jest.fn(),
    },
  };
});

const handoff: jest.Mock =
  RemediationHandoff.runForSettledInvestigation as unknown as jest.Mock;

describe("AIInvestigationQueue.failOrRequeue — the settlement outcome", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    handoff.mockClear();
  });

  test("a transient failure with attempts left that wins the requeue reports 'requeued'", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const outcome: "requeued" | "finalized" | "noop" =
      await AIInvestigationQueue.failOrRequeue({
        aiRunId: ObjectID.generate(),
        attemptCount: 1,
        errorMessage: "LLM provider timed out",
        isPermanent: false,
      });

    expect(outcome).toBe("requeued");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAttemptCount: 1,
        set: expect.objectContaining({
          status: AIRunStatus.Queued,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        }),
      }),
    );
  });

  test("a lost requeue transition reports 'noop' — another actor owns the run now", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(0);

    const outcome: "requeued" | "finalized" | "noop" =
      await AIInvestigationQueue.failOrRequeue({
        aiRunId: ObjectID.generate(),
        attemptCount: 1,
        errorMessage: "LLM provider timed out",
        isPermanent: false,
      });

    expect(outcome).toBe("noop");
    // A lost requeue never falls through to the Error transition.
    expect(update).toHaveBeenCalledTimes(1);
  });

  test("a permanent failure that wins the Error transition reports 'finalized'", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const outcome: "requeued" | "finalized" | "noop" =
      await AIInvestigationQueue.failOrRequeue({
        aiRunId: ObjectID.generate(),
        attemptCount: 1,
        errorMessage: "No LLM provider configured for this project.",
        isPermanent: true,
      });

    expect(outcome).toBe("finalized");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAttemptCount: 1,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        }),
      }),
    );
  });

  test("exhausted attempts finalize too, even for a transient failure", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const outcome: "requeued" | "finalized" | "noop" =
      await AIInvestigationQueue.failOrRequeue({
        aiRunId: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS,
        errorMessage: "LLM provider timed out",
        isPermanent: false,
      });

    expect(outcome).toBe("finalized");
  });

  test("a lost finalize transition reports 'noop' — e.g. the run already Completed", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);

    const outcome: "requeued" | "finalized" | "noop" =
      await AIInvestigationQueue.failOrRequeue({
        aiRunId: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS,
        errorMessage: "LLM provider timed out",
        isPermanent: false,
      });

    expect(outcome).toBe("noop");
  });
});

describe("AIInvestigationQueue.requeueOrMarkStale — the terminal-stale hand-off", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    handoff.mockClear();
  });

  test("a terminally-staled incident Investigation is handed off exactly once", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const incidentId: ObjectID = ObjectID.generate();
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const outcome: "requeued" | "stale" | "noop" =
      await AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS,
        runType: AIRunType.Investigation,
        projectId,
        triggeredByIncidentId: incidentId,
      });

    expect(outcome).toBe("stale");
    expect(AIRunService.attemptStatusTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAttemptCount: MAX_INVESTIGATION_ATTEMPTS,
        set: expect.objectContaining({
          status: AIRunStatus.Stale,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        }),
      }),
    );
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(handoff).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, incidentId }),
    );
  });

  test("a requeued stale run is NOT settled — the retry owns it", async () => {
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    const staleHeartbeat: Date = new Date("2026-08-07T12:00:00.000Z");
    const runId: ObjectID = ObjectID.generate();

    const outcome: "requeued" | "stale" | "noop" =
      await AIInvestigationQueue.requeueOrMarkStale({
        id: runId,
        attemptCount: 1,
        lastHeartbeatAt: staleHeartbeat,
        runType: AIRunType.Investigation,
        projectId: ObjectID.generate(),
        triggeredByIncidentId: ObjectID.generate(),
      });

    expect(outcome).toBe("requeued");
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: runId,
        expectedAttemptCount: 1,
        expectedLastHeartbeatAt: staleHeartbeat,
        set: expect.objectContaining({
          status: AIRunStatus.Queued,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        }),
      }),
    );
    expect(handoff).not.toHaveBeenCalled();
  });

  test("a staled RemediationPlan run never hands off — only Investigations defer remediation", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    await AIInvestigationQueue.requeueOrMarkStale({
      id: ObjectID.generate(),
      attemptCount: MAX_INVESTIGATION_ATTEMPTS,
      runType: AIRunType.RemediationPlan,
      projectId: ObjectID.generate(),
      // Plan runs carry the subject ids for dashboard linkage.
      triggeredByIncidentId: ObjectID.generate(),
    });

    expect(handoff).not.toHaveBeenCalled();
  });

  test("a lost Stale transition does not hand off — the winning actor settles", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);

    const outcome: "requeued" | "stale" | "noop" =
      await AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS,
        runType: AIRunType.Investigation,
        projectId: ObjectID.generate(),
        triggeredByIncidentId: ObjectID.generate(),
      });

    expect(outcome).toBe("noop");
    expect(handoff).not.toHaveBeenCalled();
  });
});

describe("AIInvestigationQueue.processQueuedRuns — TTL expiry settles too", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    handoff.mockClear();
  });

  function mockExpiredRun(run: Partial<AIRun>): void {
    jest
      .spyOn(AIRunService, "findBy")
      // First call: the expired batch. Second call: nothing left to claim.
      .mockResolvedValueOnce([run as unknown as AIRun])
      .mockResolvedValueOnce([]);
  }

  test("an expired incident Investigation that WON the Cancelled transition is handed off", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const incidentId: ObjectID = ObjectID.generate();
    mockExpiredRun({
      id: ObjectID.generate(),
      projectId,
      runType: AIRunType.Investigation,
      triggeredByIncidentId: incidentId,
    });
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    await AIInvestigationQueue.processQueuedRuns();

    expect(handoff).toHaveBeenCalledTimes(1);
    expect(handoff).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, incidentId }),
    );
  });

  test("an expired RemediationPlan run is cancelled but never handed off", async () => {
    mockExpiredRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      runType: AIRunType.RemediationPlan,
      triggeredByIncidentId: ObjectID.generate(),
    });
    const update: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await AIInvestigationQueue.processQueuedRuns();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          status: AIRunStatus.Cancelled,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        }),
      }),
    );
    expect(handoff).not.toHaveBeenCalled();
  });

  test("a lost Cancelled transition does not hand off — the claimer's executor settles", async () => {
    mockExpiredRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      runType: AIRunType.Investigation,
      triggeredByIncidentId: ObjectID.generate(),
    });
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);

    await AIInvestigationQueue.processQueuedRuns();

    expect(handoff).not.toHaveBeenCalled();
  });
});

describe("AIInvestigationEngine.executeRun — the onSettled contract", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  // Records call order so "after postAnalysis" is provable, not assumed.
  let callOrder: Array<string>;
  let postAnalysis: jest.Mock;
  let onCodeFixRecommended: jest.Mock;
  let onSettled: jest.Mock;

  function makeResult(
    overrides: Partial<ObservabilityAssistantResult> = {},
  ): ObservabilityAssistantResult {
    return {
      contentInMarkdown: "**Summary** — the root cause.",
      citations: [],
      totalTokens: 100,
      llmCallCount: 2,
      toolCallCount: 3,
      ...overrides,
    };
  }

  function makeRequest(
    overrides: Partial<InvestigationRequest> = {},
  ): InvestigationRequest {
    return {
      feature: "Test Investigation",
      contextSummary: "# Subject",
      persistCodeFixRecommendation: true,
      postAnalysis:
        postAnalysis as unknown as InvestigationRequest["postAnalysis"],
      onCodeFixRecommended:
        onCodeFixRecommended as unknown as InvestigationRequest["onCodeFixRecommended"],
      onSettled: onSettled as unknown as InvestigationRequest["onSettled"],
      ...overrides,
    };
  }

  function executeRun(
    request: InvestigationRequest = makeRequest(),
  ): Promise<void> {
    return AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount: 1,
      request,
    });
  }

  function emittedEventTypes(): Array<AIRunEventType> {
    const create: jest.Mock = AIRunEventService.create as unknown as jest.Mock;
    return create.mock.calls.map((call: Array<unknown>): AIRunEventType => {
      return (call[0] as { data: AIRunEvent }).data.eventType!;
    });
  }

  beforeEach(() => {
    callOrder = [];
    postAnalysis = jest.fn(async (): Promise<void> => {
      callOrder.push("postAnalysis");
    });
    onCodeFixRecommended = jest.fn(async (): Promise<void> => {
      callOrder.push("autoEnqueue");
    });
    onSettled = jest.fn(async (): Promise<void> => {
      callOrder.push("onSettled");
    });

    // The glass-box event trail is best-effort persistence — stub it out.
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockResolvedValue({} as unknown as AIRunEvent);
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: true,
        codeFixRecommended: true,
        source: "classification",
      });
    jest
      .spyOn(AIRunService, "finalizeInvestigationCodeFixRecommendation")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    handoff.mockClear();
  });

  test("a successful run posts, atomically persists the snapshot, then auto-enqueues and settles", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    const complete: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    postAnalysis.mockImplementation(async (): Promise<void> => {
      expect(emittedEventTypes()).not.toContain(AIRunEventType.RunCompleted);
      callOrder.push("postAnalysis");
    });
    (
      AIRunService.finalizeInvestigationCodeFixRecommendation as unknown as jest.Mock
    ).mockImplementation(async (): Promise<number> => {
      callOrder.push("persistRecommendation");
      return 1;
    });
    (AIRunEventService.create as unknown as jest.Mock).mockImplementation(
      async (data: { data: AIRunEvent }): Promise<AIRunEvent> => {
        if (data.data.eventType === AIRunEventType.RunCompleted) {
          callOrder.push("runCompleted");
        }
        return {} as AIRunEvent;
      },
    );

    await executeRun();

    expect(postAnalysis).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual([
      "postAnalysis",
      "persistRecommendation",
      "autoEnqueue",
      "runCompleted",
      "onSettled",
    ]);
    expect(emittedEventTypes()).toContain(AIRunEventType.RunCompleted);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AIRunStatus.Running,
        expectedAttemptCount: 1,
        set: expect.objectContaining({
          status: AIRunStatus.Completed,
          codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
        }),
      }),
    );

    const postedAnalysisMarkdown: string = postAnalysis.mock.calls[0]![0]
      .analysisMarkdown as string;
    expect(
      AIRunService.finalizeInvestigationCodeFixRecommendation,
    ).toHaveBeenCalledWith({
      aiRunId,
      recommendation: AIRunCodeFixRecommendation.Recommended,
      taskContext: {
        sourceInvestigationRunId: aiRunId.toString(),
        sourceInvestigationAnalysisMarkdown: postedAnalysisMarkdown,
      },
    });
    expect(onCodeFixRecommended).toHaveBeenCalledWith({
      analysisMarkdown: postedAnalysisMarkdown,
    });
    expect(postedAnalysisMarkdown).toContain(
      "## 🧠 AI — Automated Root Cause Analysis",
    );
  });

  test("a confident non-code analysis settles NotRecommended", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: true,
        codeFixRecommended: false,
        source: "classification",
      });

    await executeRun();

    expect(postAnalysis).toHaveBeenCalledTimes(1);
    expect(
      AIRunService.finalizeInvestigationCodeFixRecommendation,
    ).toHaveBeenCalledWith({
      aiRunId,
      recommendation: AIRunCodeFixRecommendation.NotRecommended,
    });
    expect(onCodeFixRecommended).not.toHaveBeenCalled();
  });

  test("an inconsistent positive field fails closed through the shared code-fix helper", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: false,
        codeFixRecommended: true,
        source: "classification",
      });

    await executeRun();

    expect(
      AIRunService.finalizeInvestigationCodeFixRecommendation,
    ).toHaveBeenCalledWith({
      aiRunId,
      recommendation: AIRunCodeFixRecommendation.NotRecommended,
    });
    expect(onCodeFixRecommended).not.toHaveBeenCalled();
  });

  test("a transient recommendation write is retried up to a successful third attempt", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    (
      AIRunService.finalizeInvestigationCodeFixRecommendation as unknown as jest.Mock
    )
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(1);

    await executeRun();

    expect(
      AIRunService.finalizeInvestigationCodeFixRecommendation,
    ).toHaveBeenCalledTimes(3);
    expect(onCodeFixRecommended).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  test("a zero-row recommendation write is safe and is not retried", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    (
      AIRunService.finalizeInvestigationCodeFixRecommendation as unknown as jest.Mock
    ).mockResolvedValue(0);

    await executeRun();

    expect(
      AIRunService.finalizeInvestigationCodeFixRecommendation,
    ).toHaveBeenCalledTimes(1);
    expect(onCodeFixRecommended).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  test("a non-incident engine consumer neither enters Pending nor persists a recommendation", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    const complete: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await executeRun(makeRequest({ persistCodeFixRecommendation: undefined }));

    const completedSet: Record<string, unknown> = complete.mock.calls[0]![0]
      .set as Record<string, unknown>;
    expect(completedSet["codeFixRecommendation"]).toBeUndefined();
    expect(
      AIRunService.finalizeInvestigationCodeFixRecommendation,
    ).not.toHaveBeenCalled();
    expect(postAnalysis).toHaveBeenCalledTimes(1);
  });

  test("carries the subject lane through the assistant and confidence calls", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const answer: jest.SpyInstance = jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    const confidence: jest.SpyInstance = jest.spyOn(
      AIConfidenceSignal,
      "computeConfidenceSignal",
    );
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    await executeRun(makeRequest({ incidentId }));

    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        aiRunId,
        incidentId,
        alertId: undefined,
      }),
    );
    expect(confidence).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        aiRunId,
        incidentId,
        alertId: undefined,
      }),
    );
  });

  test("an empty analysis still settles — but posts nothing", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult({ contentInMarkdown: "   " }));
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    const confidence: jest.SpyInstance = jest.spyOn(
      AIConfidenceSignal,
      "computeConfidenceSignal",
    );

    await executeRun();

    expect(postAnalysis).not.toHaveBeenCalled();
    expect(confidence).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(emittedEventTypes()).toContain(AIRunEventType.RunCompleted);
    expect(
      AIRunService.finalizeInvestigationCodeFixRecommendation,
    ).toHaveBeenCalledWith({
      aiRunId,
      recommendation: AIRunCodeFixRecommendation.NotRecommended,
    });
  });

  test("a lost Completed CAS neither posts nor settles — the winning attempt owns both", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);

    await executeRun();

    expect(postAnalysis).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    expect(
      AIRunService.finalizeInvestigationCodeFixRecommendation,
    ).not.toHaveBeenCalled();
  });

  test("an agent failure that failOrRequeue FINALIZED settles", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockRejectedValue(new Error("provider 500"));
    jest
      .spyOn(AIInvestigationQueue, "failOrRequeue")
      .mockResolvedValue("finalized");

    await executeRun();

    expect(postAnalysis).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(emittedEventTypes()).toContain(AIRunEventType.RunFailed);
  });

  test("an agent failure that was REQUEUED does not settle — the retry will", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockRejectedValue(new Error("provider timed out"));
    jest
      .spyOn(AIInvestigationQueue, "failOrRequeue")
      .mockResolvedValue("requeued");

    await executeRun();

    expect(onSettled).not.toHaveBeenCalled();
    expect(emittedEventTypes()).not.toContain(AIRunEventType.RunFailed);
  });

  test("a stale failing attempt that lost ownership emits no terminal event", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockRejectedValue(new Error("stale attempt finished late"));
    jest.spyOn(AIInvestigationQueue, "failOrRequeue").mockResolvedValue("noop");

    await executeRun();

    expect(onSettled).not.toHaveBeenCalled();
    expect(emittedEventTypes()).not.toContain(AIRunEventType.RunFailed);
  });

  test("a postAnalysis failure after the WON Completed transition still settles", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    // failOrRequeue no-ops on a Completed run — the run stays settled by us.
    jest.spyOn(AIInvestigationQueue, "failOrRequeue").mockResolvedValue("noop");
    postAnalysis.mockImplementation(async (): Promise<void> => {
      throw new Error("feed service down");
    });

    await executeRun();

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(emittedEventTypes()).not.toContain(AIRunEventType.RunCompleted);
    expect(emittedEventTypes()).toContain(AIRunEventType.RunFailed);
    expect(
      AIRunService.finalizeInvestigationCodeFixRecommendation,
    ).toHaveBeenCalledWith({
      aiRunId,
      recommendation: AIRunCodeFixRecommendation.NotRecommended,
    });
    expect(onCodeFixRecommended).not.toHaveBeenCalled();
  });

  test("an onSettled failure never rejects executeRun", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    const failOrRequeue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "failOrRequeue",
    );
    onSettled.mockImplementation(async (): Promise<void> => {
      throw new Error("rule engine down");
    });

    await expect(executeRun()).resolves.toBeUndefined();

    expect(postAnalysis).toHaveBeenCalledTimes(1);
    // The swallowed settlement failure never re-enters the retry policy.
    expect(failOrRequeue).not.toHaveBeenCalled();
  });
});

/*
 * The investigation TL;DR (see InvestigationTldr) is display-only: opted-in
 * subject runs get one, it is stored before the report is posted so the panel
 * never renders a report without its summary, and NO failure of it — a
 * degraded null, a failed write — may delay or fail the run.
 */
describe("AIInvestigationEngine.executeRun — the investigation TL;DR", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();
  const TLDR: string = "Checkout is failing on an exhausted connection pool.";

  let callOrder: Array<string>;
  let postAnalysis: jest.Mock;

  function makeRequest(
    overrides: Partial<InvestigationRequest> = {},
  ): InvestigationRequest {
    return {
      feature: "Test Investigation",
      contextSummary: "# Subject",
      persistCodeFixRecommendation: true,
      persistAnalysisTldr: true,
      postAnalysis:
        postAnalysis as unknown as InvestigationRequest["postAnalysis"],
      ...overrides,
    };
  }

  function executeRun(
    request: InvestigationRequest = makeRequest(),
  ): Promise<void> {
    return AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount: 1,
      request,
    });
  }

  beforeEach(() => {
    callOrder = [];
    postAnalysis = jest.fn(async (): Promise<void> => {
      callOrder.push("postAnalysis");
    });

    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockResolvedValue({} as unknown as AIRunEvent);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest
      .spyOn(AIRunService, "finalizeInvestigationCodeFixRecommendation")
      .mockResolvedValue(1);
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: true,
        codeFixRecommended: false,
        source: "classification",
      });
    jest.spyOn(ObservabilityAssistant, "answerQuestion").mockResolvedValue({
      contentInMarkdown: "**Summary** — the connection pool ran dry.",
      citations: [],
      totalTokens: 100,
      llmCallCount: 2,
      toolCallCount: 3,
    } as ObservabilityAssistantResult);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    handoff.mockClear();
  });

  test("an opted-in run stores the summary BEFORE the report is posted", async () => {
    jest.spyOn(InvestigationTldr, "generateTldr").mockResolvedValue(TLDR);
    const store: jest.SpyInstance = jest
      .spyOn(AIRunService, "setInvestigationAnalysisTldr")
      .mockImplementation(async (): Promise<number> => {
        callOrder.push("storeTldr");
        return 1;
      });

    await executeRun();

    expect(store).toHaveBeenCalledWith({ aiRunId, analysisTldr: TLDR });
    expect(callOrder).toEqual(["storeTldr", "postAnalysis"]);
  });

  test("summarizes the model's own analysis, not the branded wrapper", async () => {
    const generate: jest.SpyInstance = jest
      .spyOn(InvestigationTldr, "generateTldr")
      .mockResolvedValue(TLDR);
    jest
      .spyOn(AIRunService, "setInvestigationAnalysisTldr")
      .mockResolvedValue(1);

    await executeRun(makeRequest({ incidentId: ObjectID.generate() }));

    const summarized: string = (
      generate.mock.calls[0]![0] as { analysisMarkdown: string }
    ).analysisMarkdown;

    expect(summarized).toBe("**Summary** — the connection pool ran dry.");
    expect(summarized).not.toContain("Automated Root Cause Analysis");
    expect(summarized).not.toContain("Evidence checked");
  });

  test("runs concurrently with the confidence classification, not after it", async () => {
    /*
     * The classification only resolves once the TL;DR call has started. If
     * the engine awaited them in sequence this test would never settle, so
     * passing IS the proof that both are in flight together.
     */
    let releaseClassification: () => void = (): void => {};
    const classificationStarted: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        releaseClassification = resolve;
      },
    );

    jest
      .spyOn(InvestigationTldr, "generateTldr")
      .mockImplementation(async (): Promise<string | null> => {
        releaseClassification();
        return TLDR;
      });
    (
      AIConfidenceSignal.computeConfidenceSignal as unknown as jest.Mock
    ).mockImplementation(async () => {
      await classificationStarted;
      return {
        confident: true,
        codeFixRecommended: false,
        source: "classification",
      };
    });
    jest
      .spyOn(AIRunService, "setInvestigationAnalysisTldr")
      .mockResolvedValue(1);

    await executeRun();

    expect(postAnalysis).toHaveBeenCalledTimes(1);
    expect(InvestigationTldr.generateTldr).toHaveBeenCalledTimes(1);
  });

  test("a degraded (null) summary writes nothing and still publishes the report", async () => {
    jest.spyOn(InvestigationTldr, "generateTldr").mockResolvedValue(null);
    const store: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "setInvestigationAnalysisTldr",
    );

    await executeRun();

    expect(store).not.toHaveBeenCalled();
    expect(postAnalysis).toHaveBeenCalledTimes(1);
    expect(emittedTypes()).toContain(AIRunEventType.RunCompleted);
  });

  test("a failed TL;DR write never fails the run", async () => {
    jest.spyOn(InvestigationTldr, "generateTldr").mockResolvedValue(TLDR);
    jest
      .spyOn(AIRunService, "setInvestigationAnalysisTldr")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(executeRun()).resolves.toBeUndefined();

    expect(postAnalysis).toHaveBeenCalledTimes(1);
    expect(emittedTypes()).toContain(AIRunEventType.RunCompleted);
    expect(emittedTypes()).not.toContain(AIRunEventType.RunFailed);
  });

  test("a run whose row is no longer Completed is logged, not retried or failed", async () => {
    jest.spyOn(InvestigationTldr, "generateTldr").mockResolvedValue(TLDR);
    const store: jest.SpyInstance = jest
      .spyOn(AIRunService, "setInvestigationAnalysisTldr")
      .mockResolvedValue(0);

    await expect(executeRun()).resolves.toBeUndefined();

    expect(store).toHaveBeenCalledTimes(1);
    expect(postAnalysis).toHaveBeenCalledTimes(1);
  });

  test("an engine user without the opt-in never spends the call", async () => {
    const generate: jest.SpyInstance = jest.spyOn(
      InvestigationTldr,
      "generateTldr",
    );
    const store: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "setInvestigationAnalysisTldr",
    );

    await executeRun(makeRequest({ persistAnalysisTldr: undefined }));

    expect(generate).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(postAnalysis).toHaveBeenCalledTimes(1);
  });

  test("a run that produced no analysis never spends the call", async () => {
    (
      ObservabilityAssistant.answerQuestion as unknown as jest.Mock
    ).mockResolvedValue({
      contentInMarkdown: "   ",
      citations: [],
      totalTokens: 0,
      llmCallCount: 1,
      toolCallCount: 0,
    });
    const generate: jest.SpyInstance = jest.spyOn(
      InvestigationTldr,
      "generateTldr",
    );

    await executeRun();

    expect(generate).not.toHaveBeenCalled();
    expect(postAnalysis).not.toHaveBeenCalled();
  });

  function emittedTypes(): Array<AIRunEventType> {
    const create: jest.Mock = AIRunEventService.create as unknown as jest.Mock;
    return create.mock.calls.map((call: Array<unknown>): AIRunEventType => {
      return (call[0] as { data: AIRunEvent }).data.eventType!;
    });
  }
});
