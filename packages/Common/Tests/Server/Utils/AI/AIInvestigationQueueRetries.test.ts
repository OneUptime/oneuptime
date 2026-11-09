import AIInvestigationQueue, {
  FailedAttemptResult,
  MAX_INVESTIGATION_ATTEMPTS,
  QueuedRunRef,
} from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIRunRetryPolicy from "../../../../Server/Utils/AI/AIRunRetryPolicy";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIService from "../../../../Server/Services/AIService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../Models/DatabaseModels/Project";
import {
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../../Types/AI/AIRunAttempt";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The queue's run-level retries (issues #6437, #6438). The customer's triage
 * failed because its AI provider did not answer within 120 seconds, three
 * times in a row, each attempt at once after the last. Now:
 *   (a) a provider failure gets three attempts, waiting a minute and then
 *       five before the next (AIRun.retryAt), and any other failure two;
 *   (b) a refused key, a missing provider or a full context window are not
 *       tried again at all;
 *   (c) every attempt says how it ended (AttemptEnded / RunFailed), with
 *       the attempt, the attempts it gets, and when the next is due - the
 *       stale sweep and a shutdown's hand-back too, for the attempt that
 *       cannot say so itself;
 *   (d) the poller does not send a run before its next attempt is due, and
 *       does not expire one while it waits for it.
 */

const CUSTOMER_TIMEOUT: string =
  "OpenAICompatible API request failed: the LLM provider did not respond within 120 seconds.";

class ProviderAnswer extends Error {
  public statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

interface TransitionCall {
  aiRunId: ObjectID;
  fromStatus: AIRunStatus;
  expectedAttemptCount?: number;
  set: {
    status: AIRunStatus;
    retryAt?: Date;
    errorMessage?: string;
    completedAt?: Date;
  };
}

function lastTransition(transition: jest.SpyInstance): TransitionCall {
  return transition.mock.calls[
    transition.mock.calls.length - 1
  ]![0] as TransitionCall;
}

function secondsFromNow(date: Date): number {
  return (date.getTime() - Date.now()) / 1000;
}

describe("AIInvestigationQueue.failOrRequeueWithDetails", () => {
  let transition: jest.SpyInstance;

  beforeEach(() => {
    transition = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the customer's timeout on the first attempt waits about a minute, and says so", async () => {
    const aiRunId: ObjectID = ObjectID.generate();

    const result: FailedAttemptResult =
      await AIInvestigationQueue.failOrRequeueWithDetails({
        aiRunId,
        attemptCount: 1,
        errorMessage: CUSTOMER_TIMEOUT,
        isPermanent: false,
      });

    expect(result.outcome).toBe("requeued");

    const call: TransitionCall = lastTransition(transition);
    expect(call).toMatchObject({
      aiRunId,
      fromStatus: AIRunStatus.Running,
      expectedAttemptCount: 1,
      set: {
        status: AIRunStatus.Queued,
        errorMessage: `Attempt 1 failed and the run was requeued: ${CUSTOMER_TIMEOUT}`,
      },
    });
    // A minute, a fifth either way.
    expect(secondsFromNow(call.set.retryAt!)).toBeGreaterThanOrEqual(46);
    expect(secondsFromNow(call.set.retryAt!)).toBeLessThanOrEqual(73);

    // The run's activity says the same: when the next attempt is due.
    expect(result.attemptEnd).toEqual({
      outcome: AIRunAttemptOutcome.WillRetry,
      failureKind: AIRunFailureKind.ProviderTimeout,
      attempt: 1,
      maxAttempts: 3,
      nextAttemptAt: call.set.retryAt!.toISOString(),
      timeoutInSeconds: 120,
    });
  });

  test("the second waits about five minutes", async () => {
    await AIInvestigationQueue.failOrRequeueWithDetails({
      aiRunId: ObjectID.generate(),
      attemptCount: 2,
      errorMessage: CUSTOMER_TIMEOUT,
      isPermanent: false,
    });

    const call: TransitionCall = lastTransition(transition);
    expect(call.set.status).toBe(AIRunStatus.Queued);
    expect(secondsFromNow(call.set.retryAt!)).toBeGreaterThanOrEqual(238);
    expect(secondsFromNow(call.set.retryAt!)).toBeLessThanOrEqual(361);
  });

  test("the third gives up: Error, finished, with the provider's own words", async () => {
    const result: FailedAttemptResult =
      await AIInvestigationQueue.failOrRequeueWithDetails({
        aiRunId: ObjectID.generate(),
        attemptCount: AIRunRetryPolicy.PROVIDER_FAILURE_MAX_ATTEMPTS,
        errorMessage: CUSTOMER_TIMEOUT,
        isPermanent: false,
      });

    expect(result).toEqual({
      outcome: "finalized",
      attemptEnd: {
        outcome: AIRunAttemptOutcome.GaveUp,
        failureKind: AIRunFailureKind.ProviderTimeout,
        attempt: 3,
        maxAttempts: 3,
        timeoutInSeconds: 120,
      },
    });

    const call: TransitionCall = lastTransition(transition);
    expect(call.set.status).toBe(AIRunStatus.Error);
    expect(call.set.errorMessage).toBe(CUSTOMER_TIMEOUT);
    expect(call.set.completedAt).toBeInstanceOf(Date);
    expect(call.set.retryAt).toBeUndefined();
  });

  test("a provider's 503 with no words a person reads is still the provider's: three attempts", async () => {
    const result: FailedAttemptResult =
      await AIInvestigationQueue.failOrRequeueWithDetails({
        aiRunId: ObjectID.generate(),
        attemptCount: 2,
        errorMessage: "OpenAI API error: {}",
        isPermanent: false,
        error: new ProviderAnswer("OpenAI API error: {}", 503),
      });

    expect(result.outcome).toBe("requeued");
    expect(result.attemptEnd).toMatchObject({
      failureKind: AIRunFailureKind.ProviderUnavailable,
      attempt: 2,
      maxAttempts: 3,
    });
  });

  test("a refused key is not tried again, even on the first attempt", async () => {
    const result: FailedAttemptResult =
      await AIInvestigationQueue.failOrRequeueWithDetails({
        aiRunId: ObjectID.generate(),
        attemptCount: 1,
        errorMessage: "OpenAI API error: invalid_api_key",
        isPermanent: false,
        error: new ProviderAnswer("OpenAI API error: invalid_api_key", 401),
      });

    expect(result).toEqual({
      outcome: "finalized",
      attemptEnd: {
        outcome: AIRunAttemptOutcome.GaveUp,
        failureKind: AIRunFailureKind.ProviderRejected,
        attempt: 1,
        maxAttempts: 1,
      },
    });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(lastTransition(transition).set.status).toBe(AIRunStatus.Error);
  });

  test("any other failure is tried once more, after a minute, as before", async () => {
    const first: FailedAttemptResult =
      await AIInvestigationQueue.failOrRequeueWithDetails({
        aiRunId: ObjectID.generate(),
        attemptCount: 1,
        errorMessage: "The tool loop crashed",
        isPermanent: false,
      });

    expect(first.outcome).toBe("requeued");
    expect(first.attemptEnd).toMatchObject({
      failureKind: AIRunFailureKind.Other,
      maxAttempts: MAX_INVESTIGATION_ATTEMPTS,
    });

    const last: FailedAttemptResult =
      await AIInvestigationQueue.failOrRequeueWithDetails({
        aiRunId: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS,
        errorMessage: "The tool loop crashed",
        isPermanent: false,
      });

    expect(last.outcome).toBe("finalized");
  });

  test("an attempt that may have changed something outside OneUptime is never started over", async () => {
    const result: FailedAttemptResult =
      await AIInvestigationQueue.failOrRequeueWithDetails({
        aiRunId: ObjectID.generate(),
        attemptCount: 1,
        errorMessage: CUSTOMER_TIMEOUT,
        isPermanent: false,
        mayHaveChangedSomething: true,
      });

    expect(result.outcome).toBe("finalized");
    expect(lastTransition(transition).set.status).toBe(AIRunStatus.Error);
  });

  test("a lost requeue is a noop, and still says how the attempt would have ended", async () => {
    transition.mockResolvedValue(0);

    const result: FailedAttemptResult =
      await AIInvestigationQueue.failOrRequeueWithDetails({
        aiRunId: ObjectID.generate(),
        attemptCount: 1,
        errorMessage: CUSTOMER_TIMEOUT,
        isPermanent: false,
      });

    expect(result.outcome).toBe("noop");
    expect(result.attemptEnd.outcome).toBe(AIRunAttemptOutcome.WillRetry);
    // A lost requeue never falls through to the Error transition.
    expect(transition).toHaveBeenCalledTimes(1);
  });

  test("failOrRequeue answers with the outcome alone, as its callers read it", async () => {
    await expect(
      AIInvestigationQueue.failOrRequeue({
        aiRunId: ObjectID.generate(),
        attemptCount: 1,
        errorMessage: CUSTOMER_TIMEOUT,
        isPermanent: false,
      }),
    ).resolves.toBe("requeued");
  });
});

describe("AIInvestigationQueue — the poller and a run's next attempt", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function retryAtSql(call: Array<unknown>): string {
    const query: Record<string, unknown> = (
      call[0] as { query: Record<string, unknown> }
    ).query;
    const operator: { getSql?: ((alias: string) => string) | undefined } =
      query["retryAt"] as { getSql?: ((alias: string) => string) | undefined };
    return operator?.getSql?.("retryAt") || "";
  }

  test("a run is not sent to the workers before its next attempt is due", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([]);

    await AIInvestigationQueue.processQueuedRuns();

    // The second read is what the poller sends: due now, or never failed.
    expect(retryAtSql(findBy.mock.calls[1]!)).toMatch(
      /^\(retryAt <= :\w+ or retryAt IS NULL\)$/,
    );
  });

  test("a run waiting for its next attempt is not expired: its time in the queue starts again", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([]);

    await AIInvestigationQueue.processQueuedRuns();

    expect(retryAtSql(findBy.mock.calls[0]!)).toMatch(
      /^\(retryAt < :\w+ or retryAt IS NULL\)$/,
    );
  });
});

describe("AIInvestigationQueue — an attempt that cannot say how it ended", () => {
  let appendEvent: jest.SpyInstance;

  beforeEach(() => {
    appendEvent = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue({} as unknown as AIRunEvent);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    AIInvestigationQueue.resetForTests();
  });

  test("the stale sweep's requeue ends the dead attempt's steps, after its last event", async () => {
    const run: { id: ObjectID; projectId: ObjectID; attemptCount: number } = {
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 1,
    };
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await expect(AIInvestigationQueue.requeueOrMarkStale(run)).resolves.toBe(
      "requeued",
    );

    // Due at once: the attempt did not fail, its server went away.
    const call: TransitionCall = lastTransition(transition);
    expect(Math.abs(secondsFromNow(call.set.retryAt!))).toBeLessThan(5);

    expect(appendEvent).toHaveBeenCalledWith({
      projectId: run.projectId,
      aiRunId: run.id,
      eventType: AIRunEventType.AttemptEnded,
      resultSummary: {
        attemptEnd: {
          outcome: AIRunAttemptOutcome.Stalled,
          failureKind: AIRunFailureKind.ServerStopped,
          attempt: 1,
          maxAttempts: MAX_INVESTIGATION_ATTEMPTS,
        },
      },
      afterLastEvent: true,
    });
  });

  test("the stale sweep's last word on a run out of attempts is RunFailed", async () => {
    const run: { id: ObjectID; projectId: ObjectID; attemptCount: number } = {
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: MAX_INVESTIGATION_ATTEMPTS,
    };
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    await expect(AIInvestigationQueue.requeueOrMarkStale(run)).resolves.toBe(
      "stale",
    );

    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: run.id,
        eventType: AIRunEventType.RunFailed,
        resultSummary: {
          attemptEnd: {
            outcome: AIRunAttemptOutcome.GaveUp,
            failureKind: AIRunFailureKind.ServerStopped,
            attempt: MAX_INVESTIGATION_ATTEMPTS,
            maxAttempts: MAX_INVESTIGATION_ATTEMPTS,
          },
        },
        afterLastEvent: true,
      }),
    );
  });

  test("a sweep that lost the transition writes nothing: whoever won says it", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);

    await expect(
      AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        attemptCount: 1,
      }),
    ).resolves.toBe("noop");

    expect(appendEvent).not.toHaveBeenCalled();
  });

  test("a run with no project read writes no event, and the sweep goes on", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    await expect(
      AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: 1,
      }),
    ).resolves.toBe("requeued");

    expect(appendEvent).not.toHaveBeenCalled();
  });

  test("an event that cannot be written never stops the sweep", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    appendEvent.mockRejectedValue(new Error("db down"));

    await expect(
      AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        attemptCount: 1,
      }),
    ).resolves.toBe("requeued");
  });

  test("a shutdown's hand-back ends the attempt's steps too, due again at once", async () => {
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
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    jest
      .spyOn(AIInvestigationQueue, "sendToWorkers")
      .mockResolvedValue(undefined);

    const run: QueuedRunRef = {
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      handedBackCount: 0,
      runType: AIRunType.Investigation,
      triggeredByIncidentId: ObjectID.generate(),
    };

    let release: () => void = (): void => {
      return undefined;
    };
    jest
      .spyOn(AIIncidentInvestigationRunner, "executeInvestigation")
      .mockReturnValue(
        new Promise<void>((resolve: () => void) => {
          release = resolve;
        }),
      );

    const processing: Promise<void> = AIInvestigationQueue.processRun(run);
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    await AIInvestigationQueue.handBackRunsInFlight();

    const call: TransitionCall = lastTransition(transition);
    expect(call.set.status).toBe(AIRunStatus.Queued);
    expect(Math.abs(secondsFromNow(call.set.retryAt!))).toBeLessThan(5);
    expect(appendEvent).toHaveBeenCalledWith({
      projectId: run.projectId,
      aiRunId: run.id,
      eventType: AIRunEventType.AttemptEnded,
      resultSummary: {
        attemptEnd: {
          outcome: AIRunAttemptOutcome.HandedBack,
          failureKind: AIRunFailureKind.ServerStopped,
        },
      },
      afterLastEvent: true,
    });

    release();
    await processing;
  });
});

describe("the AIRun row keeps when its next attempt is due", () => {
  test("retryAt is readable by every project role and written by the server alone", () => {
    const run: AIRun = new AIRun();
    const access: {
      create: Array<unknown>;
      read: Array<unknown>;
      update: Array<unknown>;
    } = run.getColumnAccessControlFor("retryAt") as unknown as {
      create: Array<unknown>;
      read: Array<unknown>;
      update: Array<unknown>;
    };

    // As the run's status is: whoever sees the run sees when it tries again.
    expect(access.read).toEqual(run.getColumnAccessControlFor("status")!.read);
    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
  });
});
