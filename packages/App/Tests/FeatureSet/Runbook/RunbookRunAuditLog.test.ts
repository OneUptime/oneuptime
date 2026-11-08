import RunbookAPI from "../../../FeatureSet/Runbook/API/Runbook";
import RunRunbook from "../../../FeatureSet/Runbook/Services/RunRunbook";
import CommonAPI from "Common/Server/API/CommonAPI";
import AuditLogService from "Common/Server/Services/AuditLogService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookService from "Common/Server/Services/RunbookService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import OnBehalfOfProps from "Common/Server/Utils/AuditLog/OnBehalfOfProps";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import { getRunbookStepExecutionChanges } from "Common/Utils/Runbook/RunbookStepExecutionChanges";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT PEOPLE DO TO A RUNBOOK RUN, IN THE AUDIT LOG (issue #6283).
 *
 * Approving, completing and skipping a step write the run round
 * DatabaseService's hooks (a compare-and-set), so nothing reached the audit
 * log; starting and cancelling a run were written as plain root, so the
 * audit log credited them to System, and kept them only when the project
 * stores system events. Pinned here is what reaches the audit log from each
 * route, and when:
 *
 *   - a step action: one recordUpdate, by the person, once the action
 *     stands - never for a refused or lost write, nor one whose pause was
 *     put back;
 *   - a cancel and a start: written as OneUptime, in the person's name
 *     (OnBehalfOfProps), the cancel naming the run's status.
 *
 * What the recorder makes of it is pinned in ee
 * (Tests/Server/AuditLog/AuditLogRunbookRuns.test.ts).
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

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const api: RunbookAPI = new RunbookAPI();

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const runbookId: ObjectID = ObjectID.generate();
const executionId: ObjectID = ObjectID.generate();
const apiKeyId: ObjectID = ObjectID.generate();

function memberProps(): DatabaseCommonInteractionProps {
  return {
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
            permission: Permission.ProjectMember,
            labelIds: [],
          },
        ],
      },
    },
  };
}

function apiKeyProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userType: UserType.API,
    apiKeyId,
    apiKeyName: "Deploy bot",
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
          {
            _type: "UserPermission",
            permission: Permission.CreateRunbookExecution,
            labelIds: [],
          },
        ],
      },
    },
  };
}

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
 * Paused on a step, the way the execution loop leaves a run: a checklist
 * step done (with what it printed), the step it waits on, and two after it.
 */
function pausedRun(waiting: RunbookStep): RunbookExecution {
  const steps: Array<RunbookStepExecutionState> = [
    {
      step: step("check", RunbookStepType.Manual, {
        title: "Check the dashboards",
      }),
      status: RunbookStepExecutionStatus.Completed,
      output: "token sk-live-123 printed by a script",
    },
    { step: waiting, status: RunbookStepExecutionStatus.WaitingForUser },
    {
      step: step("verify", RunbookStepType.Bash, { title: "Verify the API" }),
      status: RunbookStepExecutionStatus.Pending,
    },
    {
      step: step("notify", RunbookStepType.HttpRequest, {
        title: "Notify customers",
      }),
      status: RunbookStepExecutionStatus.Pending,
    },
  ];

  return {
    _id: executionId.toString(),
    projectId,
    runbookNameSnapshot: "Restart the API",
    status: RunbookExecutionStatus.WaitingForManualStep,
    stepExecutions: steps,
    version: 7,
  } as unknown as RunbookExecution;
}

const APPROVE_TO_RUN: RunbookStep = step("restart", RunbookStepType.Bash, {
  title: "Restart the API",
  requireApprovalBeforeRunning: true,
});

const MANUAL: RunbookStep = step("call", RunbookStepType.Manual, {
  title: "Call the on-call lead",
});

async function call(data: {
  handler: Handler;
  params: Record<string, string>;
  body?: JSONObject;
}): Promise<unknown> {
  const req: ExpressRequest = {
    params: data.params,
    query: {},
    body: data.body || {},
    headers: {},
  } as unknown as ExpressRequest;
  const next: jest.Mock = jest.fn();

  await data.handler(
    req,
    {} as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  return next.mock.calls[0] ? next.mock.calls[0][0] : undefined;
}

interface RecordedUpdate {
  model: RunbookExecution;
  before: RunbookExecution;
  updatedFields: JSONObject;
  itemId: ObjectID;
  props: DatabaseCommonInteractionProps;
  includeColumns?: Array<string>;
}

let propsSpy: jest.SpyInstance;
let findSpy: jest.SpyInstance;
let compareAndSetSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let recordUpdateSpy: jest.SpyInstance;
let order: Array<string>;

beforeEach(() => {
  jest.clearAllMocks();
  order = [];

  startExecutionMock.mockImplementation(async (): Promise<void> => {
    order.push("queued");
  });

  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(memberProps());
  findSpy = jest
    .spyOn(RunbookExecutionService, "findOneById")
    .mockResolvedValue(pausedRun(APPROVE_TO_RUN));
  compareAndSetSpy = jest
    .spyOn(RunbookExecutionService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(async (): Promise<boolean> => {
      order.push("written");
      return true;
    });
  updateSpy = jest
    .spyOn(RunbookExecutionService, "updateOneById")
    .mockResolvedValue(1);
  createSpy = jest
    .spyOn(RunbookExecutionService, "create")
    .mockImplementation((async (args: {
      data: RunbookExecution;
    }): Promise<RunbookExecution> => {
      (args.data as unknown as { _id: string })._id = executionId.toString();
      return args.data;
    }) as unknown as typeof RunbookExecutionService.create);
  recordUpdateSpy = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockImplementation(async (): Promise<void> => {
      order.push("recorded");
    });
  jest
    .spyOn(RunnerJobService, "cancelJobsForExecution")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function onlyRecorded(): RecordedUpdate {
  expect(recordUpdateSpy).toHaveBeenCalledTimes(1);
  return recordUpdateSpy.mock.calls[0]![0] as unknown as RecordedUpdate;
}

function linesOf(recorded: RecordedUpdate): Array<string> {
  return getRunbookStepExecutionChanges({
    before: recorded.before.stepExecutions,
    after: recorded.updatedFields["stepExecutions"],
  }).lines;
}

function stepParams(stepId: string): Record<string, string> {
  return { executionId: executionId.toString(), stepId };
}

describe("approving, completing and skipping a step", () => {
  test("approving a step that waits for approval adds one entry, by the person, once the run is queued", async () => {
    const thrown: unknown = await call({
      handler: api.completeManualStep,
      params: stepParams("restart"),
      body: { notes: "go ahead" },
    });

    expect(thrown).toBeUndefined();

    const recorded: RecordedUpdate = onlyRecorded();

    expect(order).toEqual(["written", "queued", "recorded"]);
    expect(recorded.model).toBeInstanceOf(RunbookExecution);
    expect(recorded.itemId.toString()).toBe(executionId.toString());
    expect(recorded.props).toEqual(memberProps());
    expect(recorded.includeColumns).toBeUndefined();
    expect(recorded.before.projectId?.toString()).toBe(projectId.toString());
    expect(recorded.before.runbookNameSnapshot).toBe("Restart the API");
    expect(Object.keys(recorded.updatedFields)).toEqual(["stepExecutions"]);
    expect(linesOf(recorded)).toEqual(['Approved "Restart the API" (step 2)']);
  });

  test("the entry's before is the list as it was, not the one the action changed in place", async () => {
    await call({
      handler: api.completeManualStep,
      params: stepParams("restart"),
    });

    const before: Array<RunbookStepExecutionState> = onlyRecorded().before
      .stepExecutions as unknown as Array<RunbookStepExecutionState>;

    expect(before[1]!.status).toBe(RunbookStepExecutionStatus.WaitingForUser);
    expect(before[1]!.approvedAt).toBeUndefined();
  });

  test("ticking off a Manual step adds an entry that reads Completed", async () => {
    findSpy.mockResolvedValue(pausedRun(MANUAL));

    await call({ handler: api.completeManualStep, params: stepParams("call") });

    expect(linesOf(onlyRecorded())).toEqual([
      'Completed "Call the on-call lead" (step 2)',
    ]);
  });

  test("skipping the step the run waits on adds an entry that reads Skipped", async () => {
    findSpy.mockResolvedValue(pausedRun(MANUAL));

    await call({
      handler: api.skipStep,
      params: stepParams("call"),
      body: { reason: "not needed" },
    });

    expect(linesOf(onlyRecorded())).toEqual([
      'Skipped "Call the on-call lead" (step 2)',
    ]);
  });

  test("skipping a later step ahead of time adds its entry, though the run stays paused", async () => {
    await call({ handler: api.skipStep, params: stepParams("notify") });

    expect(startExecutionMock).not.toHaveBeenCalled();
    expect(order).toEqual(["written", "recorded"]);
    expect(linesOf(onlyRecorded())).toEqual([
      'Skipped "Notify customers" (step 4)',
    ]);
  });

  test("through an API key, the entry carries the key", async () => {
    propsSpy.mockResolvedValue(apiKeyProps());

    await call({
      handler: api.completeManualStep,
      params: stepParams("restart"),
    });

    expect(onlyRecorded().props).toEqual(apiKeyProps());
  });

  test("a refused action records nothing", async () => {
    // A step the run has not reached cannot be approved.
    const thrown: unknown = await call({
      handler: api.completeManualStep,
      params: stepParams("verify"),
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(compareAndSetSpy).not.toHaveBeenCalled();
    expect(recordUpdateSpy).not.toHaveBeenCalled();
  });

  test("a write that loses the race records nothing", async () => {
    compareAndSetSpy.mockResolvedValue(false);

    const thrown: unknown = await call({
      handler: api.completeManualStep,
      params: stepParams("restart"),
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(recordUpdateSpy).not.toHaveBeenCalled();
  });

  test("a run that cannot be queued, whose pause is put back, records nothing", async () => {
    startExecutionMock.mockRejectedValue(new Error("queue down"));
    // The write, then the pause put back.
    compareAndSetSpy.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    const thrown: unknown = await call({
      handler: api.completeManualStep,
      params: stepParams("restart"),
    });

    expect((thrown as Error).message).toBe("queue down");
    expect(compareAndSetSpy).toHaveBeenCalledTimes(2);
    expect(recordUpdateSpy).not.toHaveBeenCalled();
  });

  test("a run that cannot be queued, but that a Worker took already, records the action: it stands", async () => {
    startExecutionMock.mockRejectedValue(new Error("queue down"));
    compareAndSetSpy.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const thrown: unknown = await call({
      handler: api.completeManualStep,
      params: stepParams("restart"),
    });

    expect((thrown as Error).message).toBe("queue down");
    expect(linesOf(onlyRecorded())).toEqual([
      'Approved "Restart the API" (step 2)',
    ]);
  });

  test("a pause that could not be put back at all records the action too", async () => {
    startExecutionMock.mockRejectedValue(new Error("queue down"));
    compareAndSetSpy
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("database down"));

    const thrown: unknown = await call({
      handler: api.completeManualStep,
      params: stepParams("restart"),
    });

    expect((thrown as Error).message).toBe("queue down");
    expect(recordUpdateSpy).toHaveBeenCalledTimes(1);
  });

  test("no step's output and no note reaches the entry's lines", async () => {
    await call({
      handler: api.completeManualStep,
      params: stepParams("restart"),
      body: { notes: "approved with key sk-live-999" },
    });

    expect(JSON.stringify(linesOf(onlyRecorded()))).not.toContain("sk-live");
  });
});

describe("cancelling a run", () => {
  function runningRun(): RunbookExecution {
    const run: RunbookExecution = pausedRun(MANUAL);
    run.status = RunbookExecutionStatus.Running;
    return run;
  }

  interface UpdateCall {
    id: ObjectID;
    data: JSONObject;
    props: DatabaseCommonInteractionProps;
    auditLogIncludeColumns?: Array<string>;
  }

  function onlyUpdate(): UpdateCall {
    expect(updateSpy).toHaveBeenCalledTimes(1);
    return updateSpy.mock.calls[0]![0] as unknown as UpdateCall;
  }

  test("is written as OneUptime, in the person's name, naming the run's status", async () => {
    findSpy.mockResolvedValue(runningRun());

    await call({
      handler: api.cancelExecution,
      params: { executionId: executionId.toString() },
    });

    const update: UpdateCall = onlyUpdate();

    expect(update.data["status"]).toBe(RunbookExecutionStatus.Cancelled);
    expect(update.auditLogIncludeColumns).toEqual(["status"]);
    expect(update.props).toEqual({
      isRoot: true,
      userId,
      userType: UserType.User,
    });
    // Credited, not System: the props say who, and grant nothing.
    expect(update.props.tenantId).toBeUndefined();
    expect(update.props.userTenantAccessPermission).toBeUndefined();
    expect(update.props).toEqual(OnBehalfOfProps.get(memberProps()));
  });

  test("through an API key, in the key's name", async () => {
    findSpy.mockResolvedValue(runningRun());
    propsSpy.mockResolvedValue(apiKeyProps());

    await call({
      handler: api.cancelExecution,
      params: { executionId: executionId.toString() },
    });

    expect(onlyUpdate().props).toEqual({
      isRoot: true,
      userType: UserType.API,
      apiKeyId,
      apiKeyName: "Deploy bot",
    });
  });

  test("a run that has finished is not written again, and adds no entry", async () => {
    const finished: RunbookExecution = runningRun();
    finished.status = RunbookExecutionStatus.Completed;
    findSpy.mockResolvedValue(finished);

    await call({
      handler: api.cancelExecution,
      params: { executionId: executionId.toString() },
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(recordUpdateSpy).not.toHaveBeenCalled();
  });
});

describe("starting a run", () => {
  beforeEach(() => {
    jest.spyOn(RunbookService, "findOneById").mockResolvedValue({
      _id: runbookId.toString(),
      projectId,
      name: "Restart the API",
      isEnabled: true,
      steps: [
        step("check", RunbookStepType.Manual, { title: "Check", order: 1 }),
      ],
    } as unknown as Runbook);
    jest
      .spyOn(RunbookExecutionService, "checkNamedRecordsOf")
      .mockResolvedValue(undefined as never);
  });

  test("is written as OneUptime, in the person's name, and still names them as who triggered it", async () => {
    const thrown: unknown = await call({
      handler: api.runRunbook,
      params: { runbookId: runbookId.toString() },
    });

    expect(thrown).toBeUndefined();
    expect(createSpy).toHaveBeenCalledTimes(1);

    const created: { data: RunbookExecution; props: JSONObject } = createSpy
      .mock.calls[0]![0] as unknown as {
      data: RunbookExecution;
      props: JSONObject;
    };

    expect(created.props).toEqual({
      isRoot: true,
      userId,
      userType: UserType.User,
    });
    expect(created.data.triggeredByUserId?.toString()).toBe(userId.toString());
  });
});
