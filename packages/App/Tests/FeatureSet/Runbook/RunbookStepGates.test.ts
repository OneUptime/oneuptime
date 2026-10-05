import RunbookAPI from "../../../FeatureSet/Runbook/API/Runbook";
import RunRunbook from "../../../FeatureSet/Runbook/Services/RunRunbook";
import CommonAPI from "Common/Server/API/CommonAPI";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Regression tests: a runbook's approval gates could be pre-approved or
 * skipped before the run reached them.
 *
 * The complete and skip routes used to accept ANY step of a live execution
 * and resume it. The execution loop walks past every step already Completed
 * or Skipped, so completing a Manual "L2 approval" step while the run was
 * still paused on step one — or before it even got there — meant the run
 * never stopped at the approval at all. Skipping a pending approval step
 * removed it the same way. And each call enqueued the execution again,
 * whether or not it was paused, so one on a running execution started a
 * second loop over the same steps.
 *
 * The execution loop and the queue are mocked: what matters is what the
 * route writes and whether it resumes the run. The rules themselves are
 * pinned in Common/Tests/Types/Runbook/RunbookStepAction.test.ts.
 * ---------------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
    },
  };
});

// Also keeps BullMQ, pulled in through QueueRunbook, out of this suite.
jest.mock("../../../FeatureSet/Runbook/Services/RunRunbook", () => {
  return {
    __esModule: true,
    default: {
      startExecution: jest.fn(),
    },
  };
});

const startExecutionMock: jest.Mock =
  RunRunbook.startExecution as unknown as jest.Mock;

const api: RunbookAPI = new RunbookAPI();

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const COMPLETE: Handler = api.completeManualStep;
const SKIP: Handler = api.skipStep;

interface CompareAndSetCall {
  id: ObjectID;
  data: {
    stepExecutions: Array<RunbookStepExecutionState>;
    status?: RunbookExecutionStatus;
    version?: number;
  };
  expectedData: { status: RunbookExecutionStatus; version?: number };
}

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const executionId: ObjectID = ObjectID.generate();

function step(
  id: string,
  type: RunbookStepType,
  overrides: Partial<RunbookStep> = {},
): RunbookStep {
  return {
    id,
    order: 0,
    type,
    title: id,
    config: {} as RunbookStep["config"],
    ...overrides,
  };
}

/*
 * The runbook from the report: a checklist step, an "L2 approval" sign-off,
 * a remediation that waits for approval after it runs, and a notification.
 */
function stepExecutions(statuses: {
  check: RunbookStepExecutionStatus;
  l2?: RunbookStepExecutionStatus;
  restart?: RunbookStepExecutionStatus;
  notify?: RunbookStepExecutionStatus;
}): Array<RunbookStepExecutionState> {
  return [
    {
      step: step("check", RunbookStepType.Manual, {
        title: "Check the dashboards",
      }),
      status: statuses.check,
    },
    {
      step: step("l2", RunbookStepType.Manual, { title: "L2 approval" }),
      status: statuses.l2 || RunbookStepExecutionStatus.Pending,
    },
    {
      step: step("restart", RunbookStepType.Bash, {
        title: "Restart the web tier",
        requireApproval: true,
      }),
      status: statuses.restart || RunbookStepExecutionStatus.Pending,
    },
    {
      step: step("notify", RunbookStepType.HttpRequest, {
        title: "Post to Slack",
      }),
      status: statuses.notify || RunbookStepExecutionStatus.Pending,
    },
  ];
}

// Paused on step one, the way the execution loop leaves a run.
function pausedOnFirstStep(): RunbookExecution {
  return execution(
    RunbookExecutionStatus.WaitingForManualStep,
    stepExecutions({ check: RunbookStepExecutionStatus.WaitingForUser }),
  );
}

function execution(
  status: RunbookExecutionStatus,
  steps: Array<RunbookStepExecutionState>,
): RunbookExecution {
  return {
    _id: executionId.toString(),
    projectId,
    status,
    stepExecutions: steps,
    version: 7,
  } as unknown as RunbookExecution;
}

interface CallResult {
  thrown: unknown;
}

async function call(
  handler: Handler,
  stepId: string,
  body: JSONObject = {},
): Promise<CallResult> {
  const req: ExpressRequest = {
    params: { executionId: executionId.toString(), stepId },
    query: {},
    body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {} as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn();

  await handler(req, res, next as unknown as NextFunction);

  return { thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined };
}

describe("Runbook approval gates cannot be pre-approved or skipped", () => {
  let findSpy: jest.SpyInstance;
  let compareAndSetSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    startExecutionMock.mockResolvedValue(undefined);

    // A member holding the advance permission, and nothing more.
    const props: DatabaseCommonInteractionProps = {
      tenantId: projectId,
      userId,
      userType: UserType.User,
      userTenantAccessPermission: {
        [projectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId,
          permissions: [
            {
              _type: "UserPermission",
              permission: Permission.EditRunbookExecution,
              labelIds: [],
            },
          ],
        },
      },
    };
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);

    findSpy = jest
      .spyOn(RunbookExecutionService, "findOneById")
      .mockResolvedValue(pausedOnFirstStep());
    compareAndSetSpy = jest
      .spyOn(RunbookExecutionService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(true);
    updateSpy = jest
      .spyOn(RunbookExecutionService, "updateOneById")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function givenExecution(row: RunbookExecution): void {
    findSpy.mockResolvedValue(row);
  }

  function onlyWrite(): CompareAndSetCall {
    expect(compareAndSetSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
    return compareAndSetSpy.mock.calls[0]![0] as unknown as CompareAndSetCall;
  }

  function writtenStep(
    write: CompareAndSetCall,
    id: string,
  ): RunbookStepExecutionState {
    return write.data.stepExecutions.find((s: RunbookStepExecutionState) => {
      return s.step.id === id;
    })!;
  }

  function expectRefusedUntouched(result: CallResult, message: string): void {
    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as BadDataException).message).toContain(message);
    expect(compareAndSetSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(startExecutionMock).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  describe("complete", () => {
    test("REGRESSION: a future Manual approval step cannot be completed while the run is paused on an earlier step", async () => {
      const result: CallResult = await call(COMPLETE, "l2");

      expectRefusedUntouched(
        result,
        'Step "L2 approval" has not been reached yet',
      );
    });

    test("REGRESSION: a future Manual step cannot be completed before the run has started", async () => {
      givenExecution(
        execution(
          RunbookExecutionStatus.Scheduled,
          stepExecutions({ check: RunbookStepExecutionStatus.Pending }),
        ),
      );

      expectRefusedUntouched(
        await call(COMPLETE, "l2"),
        "has not been reached yet",
      );
    });

    test("REGRESSION: completing a step of a running execution neither writes nor starts a second loop", async () => {
      givenExecution(
        execution(
          RunbookExecutionStatus.Running,
          stepExecutions({
            check: RunbookStepExecutionStatus.Completed,
            l2: RunbookStepExecutionStatus.Completed,
            restart: RunbookStepExecutionStatus.Running,
          }),
        ),
      );

      expectRefusedUntouched(
        await call(COMPLETE, "notify"),
        "not waiting on a step right now",
      );
    });

    test("a pending requireApproval step cannot be approved before it has run", async () => {
      expectRefusedUntouched(
        await call(COMPLETE, "restart"),
        "has not been reached yet",
      );
    });

    test("completing the step the run is waiting on records it and resumes the run exactly once", async () => {
      const result: CallResult = await call(COMPLETE, "check", {
        notes: "dashboards look fine",
      });

      expect(result.thrown).toBeUndefined();

      const write: CompareAndSetCall = onlyWrite();
      expect(write.id.toString()).toBe(executionId.toString());

      // Only while still paused at the version the rules were checked on...
      expect(write.expectedData).toEqual({
        status: RunbookExecutionStatus.WaitingForManualStep,
        version: 7,
      });
      // ...the step is recorded and the run is handed back to the queue.
      expect(write.data.status).toBe(RunbookExecutionStatus.Scheduled);
      expect(write.data.version).toBe(8);

      const completed: RunbookStepExecutionState = writtenStep(write, "check");
      expect(completed.status).toBe(RunbookStepExecutionStatus.Completed);
      expect(completed.completedByUserId).toBe(userId.toString());
      expect(completed.notes).toBe("dashboards look fine");

      // The later gate is untouched: the run will stop there.
      expect(writtenStep(write, "l2").status).toBe(
        RunbookStepExecutionStatus.Pending,
      );

      expect(startExecutionMock).toHaveBeenCalledTimes(1);
      const startArgs: { runbookExecutionId: ObjectID } = startExecutionMock
        .mock.calls[0]![0] as { runbookExecutionId: ObjectID };
      expect(startArgs.runbookExecutionId.toString()).toBe(
        executionId.toString(),
      );
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    });

    test("approving a requireApproval step that ran and is waiting resumes the run", async () => {
      givenExecution(
        execution(
          RunbookExecutionStatus.WaitingForManualStep,
          stepExecutions({
            check: RunbookStepExecutionStatus.Completed,
            l2: RunbookStepExecutionStatus.Completed,
            restart: RunbookStepExecutionStatus.WaitingForUser,
          }),
        ),
      );

      const result: CallResult = await call(COMPLETE, "restart");

      expect(result.thrown).toBeUndefined();
      const write: CompareAndSetCall = onlyWrite();
      expect(writtenStep(write, "restart").status).toBe(
        RunbookStepExecutionStatus.Completed,
      );
      expect(write.data.status).toBe(RunbookExecutionStatus.Scheduled);
      expect(startExecutionMock).toHaveBeenCalledTimes(1);
    });

    test("REGRESSION: a second approval that loses the race does not resume the run again", async () => {
      /*
       * Both requests read the execution paused; the first one's write moved
       * it on, so this one's compare-and-set matches nothing.
       */
      compareAndSetSpy.mockResolvedValue(false);

      const result: CallResult = await call(COMPLETE, "check");

      expect(result.thrown).toBeInstanceOf(BadDataException);
      expect((result.thrown as BadDataException).message).toContain(
        "refresh and try again",
      );
      expect(compareAndSetSpy).toHaveBeenCalledTimes(1);
      expect(startExecutionMock).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("if the run cannot be queued, the pause is put back so the approval can be retried", async () => {
      /*
       * A Scheduled execution with no queue job is never picked up, and its
       * step is no longer waiting — without the rollback it would be stuck.
       */
      const queueDown: Error = new Error("Redis connection lost");
      startExecutionMock.mockRejectedValue(queueDown);

      const result: CallResult = await call(COMPLETE, "check");

      expect(result.thrown).toBe(queueDown);
      expect(compareAndSetSpy).toHaveBeenCalledTimes(2);

      const rollback: CompareAndSetCall = compareAndSetSpy.mock
        .calls[1]![0] as unknown as CompareAndSetCall;

      // Only if no Worker has taken the run since the resume was written.
      expect(rollback.expectedData).toEqual({
        status: RunbookExecutionStatus.Scheduled,
        version: 8,
      });
      expect(rollback.data.status).toBe(
        RunbookExecutionStatus.WaitingForManualStep,
      );
      expect(rollback.data.version).toBe(9);
      expect(writtenStep(rollback, "check").status).toBe(
        RunbookStepExecutionStatus.WaitingForUser,
      );
      expect(writtenStep(rollback, "check").completedByUserId).toBeUndefined();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("a step completed already — a double click after the run moved on — is refused", async () => {
      givenExecution(
        execution(
          RunbookExecutionStatus.WaitingForManualStep,
          stepExecutions({
            check: RunbookStepExecutionStatus.Completed,
            l2: RunbookStepExecutionStatus.WaitingForUser,
          }),
        ),
      );

      expectRefusedUntouched(
        await call(COMPLETE, "check"),
        'Step "Check the dashboards" is already Completed.',
      );
    });

    test("a step that is not in the execution is not found", async () => {
      const result: CallResult = await call(COMPLETE, "no-such-step");

      expect(result.thrown).toBeInstanceOf(NotFoundException);
      expect(compareAndSetSpy).not.toHaveBeenCalled();
      expect(startExecutionMock).not.toHaveBeenCalled();
    });
  });

  describe("skip", () => {
    test("skipping the step the run is waiting on resumes the run", async () => {
      const result: CallResult = await call(SKIP, "check", {
        reason: "not needed tonight",
      });

      expect(result.thrown).toBeUndefined();
      const write: CompareAndSetCall = onlyWrite();
      const skipped: RunbookStepExecutionState = writtenStep(write, "check");
      expect(skipped.status).toBe(RunbookStepExecutionStatus.Skipped);
      expect(skipped.completedByUserId).toBe(userId.toString());
      expect(skipped.notes).toBe("not needed tonight");
      expect(write.data.status).toBe(RunbookExecutionStatus.Scheduled);
      expect(startExecutionMock).toHaveBeenCalledTimes(1);
    });

    test("REGRESSION: a future Manual approval step cannot be skipped ahead of time", async () => {
      expectRefusedUntouched(
        await call(SKIP, "l2"),
        'Step "L2 approval" is a manual step',
      );
    });

    test("REGRESSION: a future requireApproval step cannot be skipped ahead of time", async () => {
      expectRefusedUntouched(
        await call(SKIP, "restart"),
        'Step "Restart the web tier" requires approval',
      );
    });

    test("a later plain automated step can be skipped ahead of time, and the run stays paused", async () => {
      const result: CallResult = await call(SKIP, "notify");

      expect(result.thrown).toBeUndefined();

      const write: CompareAndSetCall = onlyWrite();
      expect(writtenStep(write, "notify").status).toBe(
        RunbookStepExecutionStatus.Skipped,
      );
      // Still waiting on step one: no status change, nothing enqueued.
      expect(writtenStep(write, "check").status).toBe(
        RunbookStepExecutionStatus.WaitingForUser,
      );
      expect(write.data.status).toBeUndefined();
      expect(write.expectedData).toEqual({
        status: RunbookExecutionStatus.WaitingForManualStep,
        version: 7,
      });
      // The version moves, so a concurrent write from a stale read fails.
      expect(write.data.version).toBe(8);
      expect(startExecutionMock).not.toHaveBeenCalled();
    });

    test("REGRESSION: skipping a step of a running execution neither writes nor starts a second loop", async () => {
      givenExecution(
        execution(
          RunbookExecutionStatus.Running,
          stepExecutions({
            check: RunbookStepExecutionStatus.Completed,
            l2: RunbookStepExecutionStatus.Completed,
            restart: RunbookStepExecutionStatus.Running,
          }),
        ),
      );

      expectRefusedUntouched(
        await call(SKIP, "notify"),
        "can only be skipped ahead of time while the execution is paused",
      );
    });

    test("a skip that loses a race to another change is refused, not written over it", async () => {
      compareAndSetSpy.mockResolvedValue(false);

      const result: CallResult = await call(SKIP, "notify");

      expect(result.thrown).toBeInstanceOf(BadDataException);
      expect(startExecutionMock).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    test.each([
      RunbookExecutionStatus.Completed,
      RunbookExecutionStatus.Failed,
      RunbookExecutionStatus.Cancelled,
    ])(
      "nothing is skipped on a %s execution",
      async (status: RunbookExecutionStatus) => {
        givenExecution(
          execution(
            status,
            stepExecutions({ check: RunbookStepExecutionStatus.Cancelled }),
          ),
        );

        expectRefusedUntouched(
          await call(SKIP, "notify"),
          `Cannot update step on a ${status} execution`,
        );
      },
    );
  });
});
