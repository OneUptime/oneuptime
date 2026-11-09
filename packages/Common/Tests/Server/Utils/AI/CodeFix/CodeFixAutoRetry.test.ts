import CodeFixAutoRetry, {
  CODE_FIX_WRITE_MARKERS,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixAutoRetry";
import CodeFixRunQueue, {
  STALE_RUN_ERROR_MESSAGE,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixRunQueue";
import CodeFixClaimQuery from "../../../../../Server/Utils/AI/CodeFix/CodeFixClaimQuery";
import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunEventType from "../../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import { TransientAIFailureKind } from "../../../../../Types/AI/TransientAIFailure";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { CodeWorkerKind } from "../../../../../Types/Runner/CodeRepositoryRunner";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A code task's attempt that failed for a reason trying again can fix is
 * queued again IN PLACE, after a short wait, up to three attempts - and
 * never when it may already have pushed or opened anything: never a second
 * pull request, never a second push. Anything else fails the run as it
 * always did.
 */

const PROVIDER_DOWN: string =
  "The AI could not finish: LLM completion request failed";

interface TransitionCall {
  aiRunId: ObjectID;
  fromStatus: AIRunStatus;
  set: {
    status: AIRunStatus;
    autoRetryCount?: number;
    nextAttemptAt?: Date | null;
    retryReason?: string;
    errorMessage?: string;
  };
}

describe("CodeFixAutoRetry.tryAgainLater", () => {
  let run: AIRun;
  let recordedPullRequests: number;
  // What each raw query answers: the run's write lines, then its task's pull requests.
  let writeLines: Array<unknown>;
  let taskPullRequests: Array<unknown>;
  let transitionSpy: jest.SpyInstance;
  let appendEventSpy: jest.SpyInstance;
  let querySpy: jest.Mock;

  beforeEach(() => {
    run = new AIRun();
    run.id = ObjectID.generate();
    run.projectId = ObjectID.generate();
    run.runType = AIRunType.CodeFix;
    run.status = AIRunStatus.Running;
    run.codeFixTaskType = CodeFixTaskType.CodeRequest;
    run.autoRetryCount = 0;
    recordedPullRequests = 0;
    writeLines = [];
    taskPullRequests = [];

    jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
      return run;
    });
    jest
      .spyOn(AIAgentTaskPullRequestService, "countBy")
      .mockImplementation(async () => {
        return new PositiveNumber(recordedPullRequests);
      });

    querySpy = jest.fn(async (sql: string) => {
      return sql.includes('FROM "AIRunEvent"') ? writeLines : taskPullRequests;
    });
    jest.spyOn(AIRunService, "getRepository").mockReturnValue({
      manager: { query: querySpy },
    } as never);

    transitionSpy = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    appendEventSpy = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function transition(): TransitionCall {
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    return transitionSpy.mock.calls[0]![0] as TransitionCall;
  }

  function minutesUntil(date: Date | null | undefined): number {
    return Math.round((new Date(date!).getTime() - Date.now()) / 60000);
  }

  test("a provider failure with attempts left goes back to the queue, after a minute", async () => {
    expect(
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id!,
        failure: PROVIDER_DOWN,
      }),
    ).toBe(true);

    expect(transition().fromStatus).toBe(AIRunStatus.Running);
    expect(transition().set.status).toBe(AIRunStatus.Queued);
    expect(transition().set.autoRetryCount).toBe(1);
    expect(transition().set.retryReason).toBe(PROVIDER_DOWN);
    expect(minutesUntil(transition().set.nextAttemptAt)).toBe(1);

    // The conversation says so, in the run's own trail.
    expect(appendEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: run.id,
        eventType: AIRunEventType.ProgressLog,
        resultSummary: {
          message:
            "Attempt 1 of 3 failed: The AI could not finish: LLM completion request failed. Trying again by itself in 1 minute.",
          severity: "warning",
        },
      }),
    );
  });

  test("the second retry waits four minutes", async () => {
    run.autoRetryCount = 1;

    expect(
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id!,
        failure: "read ECONNRESET",
      }),
    ).toBe(true);

    expect(transition().set.autoRetryCount).toBe(2);
    expect(minutesUntil(transition().set.nextAttemptAt)).toBe(4);
  });

  test("after the third attempt it fails", async () => {
    run.autoRetryCount = 2;

    expect(
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id!,
        failure: PROVIDER_DOWN,
      }),
    ).toBe(false);
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  test("a failure trying again cannot fix fails at once, without a read", async () => {
    expect(
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id!,
        failure: "Invalid API key provided",
      }),
    ).toBe(false);
    expect(AIRunService.findOneById).not.toHaveBeenCalled();
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  test("never a run that recorded a pull request: no second pull request", async () => {
    recordedPullRequests = 1;

    expect(
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id!,
        failure: PROVIDER_DOWN,
      }),
    ).toBe(false);
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  test("never a run whose trail says it was pushing: no second push", async () => {
    writeLines = [{ "?column?": 1 }];

    expect(
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id!,
        failure: "git push failed: 502 Bad Gateway",
      }),
    ).toBe(false);
    expect(transitionSpy).not.toHaveBeenCalled();

    const parameters: Array<unknown> = querySpy.mock.calls[0]![1];
    for (const marker of CODE_FIX_WRITE_MARKERS) {
      expect(parameters).toContain(`%${marker}%`);
    }
    expect(parameters).toContain("open_pull_request");
  });

  test("a Runner that went away is not tried again when its task has a pull request", async () => {
    run.codeTaskId = ObjectID.generate();
    taskPullRequests = [{ "?column?": 1 }];

    expect(
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id!,
        failure: "stopped",
        kind: TransientAIFailureKind.RunnerWentAway,
      }),
    ).toBe(false);
    expect(querySpy.mock.calls[1]![1]).toEqual([run.codeTaskId.toString()]);
  });

  test("a Runner that went away, with nothing pushed anywhere, is tried again", async () => {
    expect(
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id!,
        failure: "stopped",
        kind: TransientAIFailureKind.RunnerWentAway,
      }),
    ).toBe(true);
  });

  test("a run stopped (or finished) meanwhile stays as it is", async () => {
    transitionSpy.mockResolvedValue(0);

    expect(
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id!,
        failure: PROVIDER_DOWN,
      }),
    ).toBe(false);
    expect(appendEventSpy).not.toHaveBeenCalled();
  });

  test("a run no longer Running, a server-run recipe or another run type is left to fail", async () => {
    for (const change of [
      () => {
        run.status = AIRunStatus.Cancelled;
      },
      () => {
        run.codeFixTaskType = CodeFixTaskType.GitHubPullRequestProductionReview;
      },
      () => {
        run.runType = AIRunType.Investigation;
      },
    ]) {
      run.status = AIRunStatus.Running;
      run.codeFixTaskType = CodeFixTaskType.CodeRequest;
      run.runType = AIRunType.CodeFix;
      change();

      expect(
        await CodeFixAutoRetry.tryAgainLater({
          runId: run.id!,
          failure: PROVIDER_DOWN,
        }),
      ).toBe(false);
    }

    expect(transitionSpy).not.toHaveBeenCalled();
  });

  test("a read that fails leaves the run to fail as before", async () => {
    jest
      .spyOn(AIAgentTaskPullRequestService, "countBy")
      .mockRejectedValue(new Error("database gone"));

    expect(
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id!,
        failure: PROVIDER_DOWN,
      }),
    ).toBe(false);
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  test("a stale run that may be tried again is queued again, not failed", async () => {
    expect(await CodeFixRunQueue.markStaleRunAsError({ id: run.id! })).toBe(
      true,
    );
    expect(transition().set.status).toBe(AIRunStatus.Queued);
  });

  test("a stale run that may not is failed, and says why", async () => {
    run.autoRetryCount = 2;

    expect(await CodeFixRunQueue.markStaleRunAsError({ id: run.id! })).toBe(
      false,
    );
    expect(transition().set.status).toBe(AIRunStatus.Error);
    expect(transition().set.errorMessage).toBe(STALE_RUN_ERROR_MESSAGE);
  });
});

describe("a run queued again by itself waits for its next attempt", () => {
  test("no worker claims it, and no queue counts it, before then", () => {
    const facts: Parameters<typeof CodeFixClaimQuery.getCondition>[0] = {
      worker: { kind: CodeWorkerKind.GlobalRunner, id: ObjectID.generate() },
      claimableTaskTypes: [CodeFixTaskType.CodeRequest],
    };

    for (const statement of [
      CodeFixClaimQuery.getNextRunStatement(facts),
      CodeFixClaimQuery.getCountStatement(facts),
    ]) {
      expect(statement.sql).toContain(
        '("run"."nextAttemptAt" IS NULL OR "run"."nextAttemptAt" <= now())',
      );
    }
  });
});
