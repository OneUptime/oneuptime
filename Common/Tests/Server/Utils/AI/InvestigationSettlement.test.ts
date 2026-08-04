import AIInvestigationQueue, {
  MAX_INVESTIGATION_ATTEMPTS,
} from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import RemediationHandoff from "../../../../Server/Utils/AI/SRE/RemediationHandoff";
import AIConfidenceSignal from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
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
        set: expect.objectContaining({ status: AIRunStatus.Queued }),
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
        set: expect.objectContaining({ status: AIRunStatus.Error }),
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

    const outcome: "requeued" | "stale" =
      await AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS,
        runType: AIRunType.Investigation,
        projectId,
        triggeredByIncidentId: incidentId,
      });

    expect(outcome).toBe("stale");
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(handoff).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, incidentId }),
    );
  });

  test("a requeued stale run is NOT settled — the retry owns it", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const outcome: "requeued" | "stale" =
      await AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: 1,
        runType: AIRunType.Investigation,
        projectId: ObjectID.generate(),
        triggeredByIncidentId: ObjectID.generate(),
      });

    expect(outcome).toBe("requeued");
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

    await AIInvestigationQueue.requeueOrMarkStale({
      id: ObjectID.generate(),
      attemptCount: MAX_INVESTIGATION_ATTEMPTS,
      runType: AIRunType.Investigation,
      projectId: ObjectID.generate(),
      triggeredByIncidentId: ObjectID.generate(),
    });

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
        set: expect.objectContaining({ status: AIRunStatus.Cancelled }),
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

  function makeRequest(): InvestigationRequest {
    return {
      feature: "Test Investigation",
      contextSummary: "# Subject",
      postAnalysis:
        postAnalysis as unknown as InvestigationRequest["postAnalysis"],
      onSettled: onSettled as unknown as InvestigationRequest["onSettled"],
    };
  }

  function executeRun(): Promise<void> {
    return AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount: 1,
      request: makeRequest(),
    });
  }

  beforeEach(() => {
    callOrder = [];
    postAnalysis = jest.fn(async (): Promise<void> => {
      callOrder.push("postAnalysis");
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
      .mockResolvedValue({ confident: true, source: "classification" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    handoff.mockClear();
  });

  test("a successful run settles AFTER the analysis was posted", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    await executeRun();

    expect(postAnalysis).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["postAnalysis", "onSettled"]);
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
  });

  test("a lost Completed CAS neither posts nor settles — the winning attempt owns both", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);

    await executeRun();

    expect(postAnalysis).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
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
