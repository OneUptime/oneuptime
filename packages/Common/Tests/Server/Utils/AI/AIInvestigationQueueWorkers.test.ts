import AIInvestigationQueue, {
  MAX_INVESTIGATION_ATTEMPTS,
  MAX_INVESTIGATION_HAND_BACKS,
  QueuedRunRef,
} from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import RemediationExecutionRunner from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIService from "../../../../Server/Services/AIService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Queue, {
  QueueJob,
  QueueName,
} from "../../../../Server/Infrastructure/Queue";
import QueueWorker from "../../../../Server/Infrastructure/QueueWorker";
import GracefulShutdown, {
  ShutdownPriority,
} from "../../../../Server/Utils/GracefulShutdown";
import logger from "../../../../Server/Utils/Logger";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunCodeFixRecommendation from "../../../../Types/AI/AIRunCodeFixRecommendation";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The investigation queue's workers, and what a server does with its runs
 * when it shuts down.
 *
 * The invariants these tests lock in:
 *   (a) a run reaches the workers as one job on the AIInvestigation queue,
 *       named for the run and the attempt count it is queued at, an incident
 *       or alert RCA ahead of background work — and a job carries the run
 *       there and back intact;
 *   (b) the poller only sends runs to the workers: it claims and runs none;
 *   (c) startWorker consumes that queue and hands runs back on shutdown;
 *   (d) on shutdown every run the server is executing goes back to Queued
 *       at the attempt its claim gave it — the fence its own execution can no
 *       longer write past — counted as handed back and sent to the workers
 *       at once; and from then on the server claims nothing;
 *   (e) a remediation execution in flight, and a run handed back too often,
 *       stay with the server for the stale sweep;
 *   (f) a handed-back claim is not a failed attempt, for failOrRequeue and
 *       requeueOrMarkStale alike.
 */

// Let every promise already resolving settle: the gates, the claim, the dispatch.
function flush(): Promise<unknown> {
  return new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
}

function incidentRun(overrides?: Partial<QueuedRunRef>): QueuedRunRef {
  return {
    id: ObjectID.generate(),
    projectId: ObjectID.generate(),
    attemptCount: 0,
    handedBackCount: 0,
    runType: AIRunType.Investigation,
    triggeredByIncidentId: ObjectID.generate(),
    ...overrides,
  };
}

// Nothing holds a run back: no cap, budget left, under the project's limits.
function openTheGates(): void {
  jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
    exhausted: false,
    limitInTokens: null,
    usedTokensToday: 0,
  });
  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockResolvedValue(null as never);
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ id: ObjectID.generate() } as unknown as Project);
  jest.spyOn(AIRunService, "countBy").mockResolvedValue(new PositiveNumber(0));
}

interface Execution {
  // The executor's spy; called once the run is executing.
  executor: jest.SpyInstance;
  // Ends the execution, and waits for processRun to return.
  finish: () => Promise<void>;
}

/*
 * Claim a run on this server and keep it executing until finish() — a long
 * investigation, mid-flight.
 */
async function executeOnThisServer(
  run: QueuedRunRef,
  executor: jest.SpyInstance,
): Promise<Execution> {
  let release: () => void = (): void => {
    return undefined;
  };
  const executing: Promise<void> = new Promise<void>((resolve: () => void) => {
    release = resolve;
  });

  executor.mockReturnValue(executing);

  const processing: Promise<void> = AIInvestigationQueue.processRun(run);

  await flush();

  return {
    executor,
    finish: async (): Promise<void> => {
      release();
      await processing;
    },
  };
}

describe("AIInvestigationQueue — the workers' queue", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    AIInvestigationQueue.resetForTests();
  });

  test.each([
    ["an incident RCA", { triggeredByIncidentId: ObjectID.generate() }],
    [
      "an alert RCA",
      {
        triggeredByIncidentId: undefined,
        triggeredByAlertId: ObjectID.generate(),
      },
    ],
  ])(
    "%s reaches the workers as one job named for the run and its attempt count, at the highest priority",
    async (_name: string, subject: Partial<QueuedRunRef>) => {
      const addJob: jest.SpyInstance = jest
        .spyOn(Queue, "addJob")
        .mockResolvedValue({} as never);
      const run: QueuedRunRef = incidentRun({
        attemptCount: 1,
        handedBackCount: 1,
        ...subject,
      });

      await AIInvestigationQueue.sendToWorkers(run);

      expect(addJob).toHaveBeenCalledTimes(1);
      expect(addJob).toHaveBeenCalledWith(
        QueueName.AIInvestigation,
        `${run.id.toString()}-1`,
        "ProcessQueuedRun",
        expect.objectContaining({
          aiRunId: run.id.toString(),
          projectId: run.projectId.toString(),
          attemptCount: 1,
          handedBackCount: 1,
        }),
        {
          // Sending a run whose job is still there must add nothing.
          skipExistenceCheck: true,
          removeWhenDone: true,
          priority: 0,
        },
      );
    },
  );

  test.each([
    [
      "a remediation plan",
      {
        runType: AIRunType.RemediationPlan,
        triggeredByAutoRemediationSuggestionId: ObjectID.generate(),
      },
    ],
    [
      "a remediation execution",
      {
        runType: AIRunType.RemediationExecution,
        triggeredByAutoRemediationSuggestionId: ObjectID.generate(),
      },
    ],
    [
      "insight triage",
      {
        triggeredByIncidentId: undefined,
        triggeredByAiInsightId: ObjectID.generate(),
      },
    ],
  ])(
    "%s waits behind every incident and alert RCA",
    async (_name: string, overrides: Partial<QueuedRunRef>) => {
      const addJob: jest.SpyInstance = jest
        .spyOn(Queue, "addJob")
        .mockResolvedValue({} as never);

      await AIInvestigationQueue.sendToWorkers(incidentRun(overrides));

      const options: { priority: number } = addJob.mock.calls[0]![4] as {
        priority: number;
      };
      expect(options.priority).toBeGreaterThan(0);
    },
  );

  test("a job that cannot be added never throws: the run stays Queued for the poller", async () => {
    jest
      .spyOn(Queue, "addJob")
      .mockRejectedValue(new Error("Redis unavailable"));
    const logError: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    await expect(
      AIInvestigationQueue.sendToWorkers(incidentRun()),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });

  test("a job carries the run to the worker intact", async () => {
    const addJob: jest.SpyInstance = jest
      .spyOn(Queue, "addJob")
      .mockResolvedValue({} as never);
    const processRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "processRun")
      .mockResolvedValue(undefined);
    const run: QueuedRunRef = incidentRun({
      attemptCount: 1,
      handedBackCount: 1,
      followUpForAlertId: ObjectID.generate(),
      ruleWaitMinutes: 15,
    });

    await AIInvestigationQueue.sendToWorkers(run);
    // BullMQ stores the job's data as JSON.
    await AIInvestigationQueue.processQueueJob(
      JSON.parse(JSON.stringify(addJob.mock.calls[0]![3])) as JSONObject,
    );

    expect(processRun).toHaveBeenCalledTimes(1);
    const received: QueuedRunRef = processRun.mock.calls[0]![0] as QueuedRunRef;
    expect(received.id.toString()).toBe(run.id.toString());
    expect(received.projectId.toString()).toBe(run.projectId.toString());
    expect(received.attemptCount).toBe(1);
    expect(received.handedBackCount).toBe(1);
    expect(received.runType).toBe(AIRunType.Investigation);
    expect(received.triggeredByIncidentId?.toString()).toBe(
      run.triggeredByIncidentId!.toString(),
    );
    expect(received.followUpForAlertId?.toString()).toBe(
      run.followUpForAlertId!.toString(),
    );
    expect(received.ruleWaitMinutes).toBe(15);
    expect(received.triggeredByAlertId).toBeUndefined();
    expect(received.triggeredByAiInsightId).toBeUndefined();
    expect(received.triggeredByAutoRemediationSuggestionId).toBeUndefined();
  });

  test.each([
    ["no data at all", {}],
    ["no project", { aiRunId: ObjectID.generate().toString() }],
    ["no run", { projectId: ObjectID.generate().toString() }],
  ])(
    "a job with %s is dropped: there is nothing to claim",
    async (_name: string, data: JSONObject) => {
      const processRun: jest.SpyInstance = jest.spyOn(
        AIInvestigationQueue,
        "processRun",
      );
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });

      await AIInvestigationQueue.processQueueJob(data);

      expect(processRun).not.toHaveBeenCalled();
    },
  );

  test("the poller sends what is still Queued to the workers and claims nothing itself", async () => {
    const queuedId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();
    const findBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findBy")
      // Nothing expired; then the runs still Queued.
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: queuedId,
          projectId,
          attemptCount: 1,
          handedBackCount: 1,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: ObjectID.generate(),
        } as unknown as AIRun,
      ]);
    const transition: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );
    const sendToWorkers: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "sendToWorkers")
      .mockResolvedValue(undefined);
    const executor: jest.SpyInstance = jest.spyOn(
      AIIncidentInvestigationRunner,
      "executeInvestigation",
    );

    await AIInvestigationQueue.processQueuedRuns();

    expect(sendToWorkers).toHaveBeenCalledWith(
      expect.objectContaining({
        id: queuedId,
        projectId,
        attemptCount: 1,
        handedBackCount: 1,
      }),
    );
    expect(transition).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
    // The hand-back count is read with the run, like its attempt count.
    expect(
      (findBy.mock.calls[1]![0] as { select: Record<string, boolean> }).select[
        "handedBackCount"
      ],
    ).toBe(true);
  });

  test("startWorker consumes the AIInvestigation queue and hands runs back when the server shuts down", async () => {
    const getWorker: jest.SpyInstance = jest
      .spyOn(QueueWorker, "getWorker")
      .mockReturnValue({} as never);
    const registerHandler: jest.SpyInstance = jest
      .spyOn(GracefulShutdown, "registerHandler")
      .mockImplementation((): void => {
        return undefined;
      });
    const processQueueJob: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "processQueueJob")
      .mockResolvedValue(undefined);
    const handBackRunsInFlight: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "handBackRunsInFlight")
      .mockResolvedValue(undefined);

    AIInvestigationQueue.startWorker({ concurrency: 7 });

    expect(getWorker).toHaveBeenCalledWith(
      QueueName.AIInvestigation,
      expect.any(Function),
      { concurrency: 7 },
    );
    expect(registerHandler).toHaveBeenCalledWith(
      "AIInvestigationQueue:HandBackRunsInFlight",
      ShutdownPriority.Workers,
      expect.any(Function),
    );

    const onJob: (job: QueueJob) => Promise<void> = getWorker.mock
      .calls[0]![1] as (job: QueueJob) => Promise<void>;
    await onJob({ data: { aiRunId: "run" } } as unknown as QueueJob);
    expect(processQueueJob).toHaveBeenCalledWith({ aiRunId: "run" });

    const onShutdown: () => Promise<void> = registerHandler.mock
      .calls[0]![2] as () => Promise<void>;
    await onShutdown();
    expect(handBackRunsInFlight).toHaveBeenCalledTimes(1);
  });
});

describe("AIInvestigationQueue — handing runs back when the server shuts down", () => {
  beforeEach(() => {
    openTheGates();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    AIInvestigationQueue.resetForTests();
  });

  test("a run being executed goes back to Queued at its claimed attempt, counted as handed back, and straight to the workers", async () => {
    const run: QueuedRunRef = incidentRun();
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    const sendToWorkers: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "sendToWorkers")
      .mockResolvedValue(undefined);
    const execution: Execution = await executeOnThisServer(
      run,
      jest.spyOn(AIIncidentInvestigationRunner, "executeInvestigation"),
    );
    expect(execution.executor).toHaveBeenCalledTimes(1);

    await AIInvestigationQueue.handBackRunsInFlight();

    expect(transition).toHaveBeenLastCalledWith({
      aiRunId: run.id,
      fromStatus: AIRunStatus.Running,
      // The claim's attempt: the fence this server's execution cannot pass.
      expectedAttemptCount: 1,
      set: expect.objectContaining({
        status: AIRunStatus.Queued,
        handedBackCount: 1,
        codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
      }),
    });
    expect(sendToWorkers).toHaveBeenCalledWith(
      expect.objectContaining({
        id: run.id,
        attemptCount: 1,
        handedBackCount: 1,
      }),
    );

    await execution.finish();
  });

  test("once it is handing back, the server claims nothing more", async () => {
    await AIInvestigationQueue.handBackRunsInFlight();
    const transition: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await AIInvestigationQueue.processRun(incidentRun());

    expect(transition).not.toHaveBeenCalled();
  });

  test.each([
    ["an incident investigation", incidentRun],
    [
      "a remediation execution",
      (): QueuedRunRef => {
        return incidentRun({
          runType: AIRunType.RemediationExecution,
          triggeredByAutoRemediationSuggestionId: ObjectID.generate(),
        });
      },
    ],
  ])(
    "%s claimed as the server starts shutting down goes straight back, never run",
    async (_name: string, makeRun: () => QueuedRunRef) => {
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockImplementationOnce(async (): Promise<number> => {
          // The shutdown begins while the claim is in flight.
          await AIInvestigationQueue.handBackRunsInFlight();
          return 1;
        })
        .mockResolvedValue(1);
      const sendToWorkers: jest.SpyInstance = jest
        .spyOn(AIInvestigationQueue, "sendToWorkers")
        .mockResolvedValue(undefined);
      const investigate: jest.SpyInstance = jest.spyOn(
        AIIncidentInvestigationRunner,
        "executeInvestigation",
      );
      const remediate: jest.SpyInstance = jest.spyOn(
        RemediationExecutionRunner,
        "executeRemediation",
      );
      const run: QueuedRunRef = makeRun();

      await AIInvestigationQueue.processRun(run);

      expect(investigate).not.toHaveBeenCalled();
      expect(remediate).not.toHaveBeenCalled();
      expect(transition).toHaveBeenLastCalledWith(
        expect.objectContaining({
          aiRunId: run.id,
          fromStatus: AIRunStatus.Running,
          expectedAttemptCount: 1,
          set: expect.objectContaining({
            status: AIRunStatus.Queued,
            handedBackCount: 1,
          }),
        }),
      );
      expect(sendToWorkers).toHaveBeenCalledWith(
        expect.objectContaining({ id: run.id, attemptCount: 1 }),
      );
    },
  );

  test("a remediation execution in flight stays with the server: its commands are not fenced by the attempt", async () => {
    const run: QueuedRunRef = incidentRun({
      runType: AIRunType.RemediationExecution,
      triggeredByAutoRemediationSuggestionId: ObjectID.generate(),
    });
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    const sendToWorkers: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "sendToWorkers")
      .mockResolvedValue(undefined);
    const execution: Execution = await executeOnThisServer(
      run,
      jest.spyOn(RemediationExecutionRunner, "executeRemediation"),
    );
    expect(execution.executor).toHaveBeenCalledTimes(1);
    transition.mockClear();

    await AIInvestigationQueue.handBackRunsInFlight();

    expect(transition).not.toHaveBeenCalled();
    expect(sendToWorkers).not.toHaveBeenCalled();

    await execution.finish();
  });

  test("a run handed back too often stays with the server, for the stale sweep to count", async () => {
    const run: QueuedRunRef = incidentRun({
      attemptCount: MAX_INVESTIGATION_HAND_BACKS,
      handedBackCount: MAX_INVESTIGATION_HAND_BACKS,
    });
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    const sendToWorkers: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "sendToWorkers")
      .mockResolvedValue(undefined);
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    const execution: Execution = await executeOnThisServer(
      run,
      jest.spyOn(AIIncidentInvestigationRunner, "executeInvestigation"),
    );
    transition.mockClear();

    await AIInvestigationQueue.handBackRunsInFlight();

    expect(transition).not.toHaveBeenCalled();
    expect(sendToWorkers).not.toHaveBeenCalled();

    await execution.finish();
  });

  test("a run that moved on before the hand-back (it completed or failed) is not sent again", async () => {
    const run: QueuedRunRef = incidentRun();
    jest
      .spyOn(AIRunService, "attemptStatusTransition")
      // The claim wins; the hand-back finds the run no longer Running.
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const sendToWorkers: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "sendToWorkers")
      .mockResolvedValue(undefined);
    const execution: Execution = await executeOnThisServer(
      run,
      jest.spyOn(AIIncidentInvestigationRunner, "executeInvestigation"),
    );

    await AIInvestigationQueue.handBackRunsInFlight();

    expect(sendToWorkers).not.toHaveBeenCalled();

    await execution.finish();
  });

  test("a run that finished is not in flight any more: nothing is handed back", async () => {
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    jest
      .spyOn(AIIncidentInvestigationRunner, "executeInvestigation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun(incidentRun());
    transition.mockClear();

    await AIInvestigationQueue.handBackRunsInFlight();

    expect(transition).not.toHaveBeenCalled();
  });
});

describe("AIInvestigationQueue — a handed-back claim is not a failed attempt", () => {
  beforeEach(() => {
    openTheGates();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    AIInvestigationQueue.resetForTests();
  });

  test.each([
    // The last attempt by count, but one claim was handed back: retried.
    ["once handed back", 1, AIRunStatus.Queued, "requeued"],
    // The same attempt with no hand-back is the last one: finalized.
    ["never handed back", 0, AIRunStatus.Error, "finalized"],
  ])(
    "a transient failure of attempt %s",
    async (
      _name: string,
      handedBackCount: number,
      status: AIRunStatus,
      expectedOutcome: string,
    ) => {
      const run: QueuedRunRef = incidentRun({
        attemptCount: MAX_INVESTIGATION_ATTEMPTS - 1,
        handedBackCount,
      });
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1);
      let outcome: string | undefined = undefined;
      jest
        .spyOn(AIIncidentInvestigationRunner, "executeInvestigation")
        .mockImplementation(
          async (data: {
            aiRunId: ObjectID;
            attemptCount: number;
          }): Promise<void> => {
            outcome = await AIInvestigationQueue.failOrRequeue({
              aiRunId: data.aiRunId,
              attemptCount: data.attemptCount,
              errorMessage: "LLM provider timed out",
              isPermanent: false,
            });
          },
        );

      await AIInvestigationQueue.processRun(run);

      expect(outcome).toBe(expectedOutcome);
      expect(transition).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fromStatus: AIRunStatus.Running,
          expectedAttemptCount: MAX_INVESTIGATION_ATTEMPTS,
          set: expect.objectContaining({ status }),
        }),
      );
    },
  );

  test("the stale sweep requeues a run whose extra claims were handed back", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const outcome: "requeued" | "stale" | "noop" =
      await AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS + 1,
        handedBackCount: 2,
      });

    expect(outcome).toBe("requeued");
  });

  test("the stale sweep still marks a run Stale once the claims that count are used up", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const outcome: "requeued" | "stale" | "noop" =
      await AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS + 1,
        handedBackCount: 1,
      });

    expect(outcome).toBe("stale");
  });
});
