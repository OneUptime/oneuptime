import Queue, { QueueName } from "../../../../../Server/Infrastructure/Queue";
import SecurityCaseFeedService from "../../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityCaseTaskService from "../../../../../Server/Services/SecurityCaseTaskService";
import { OnCreate, OnUpdate } from "../../../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../../../Server/Utils/Database/ProjectReferenceCheck";
import SecurityCaseNotifications from "../../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import SecurityCaseStepCheckRunner from "../../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner";
import SecurityCaseStepChecks, {
  SECURITY_CASE_STEP_CHECK_DELAY_MS,
  SECURITY_CASE_STEP_CHECK_JOB,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepChecks";
import SecurityCaseTask from "../../../../../Models/DatabaseModels/SecurityCaseTask";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CASE_ID,
  PROJECT_ID,
} from "../../../../Helpers/SecurityCaseStepChecks";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A change on a case checks its steps at once (#10340): a step ticked off
 * or opened again, a playbook step that ran. The case's next check moves to
 * now - so the every-minute run reads it even if the queue is down - and a
 * job checks every step a moment later, the changes of one case coalesced
 * into one check. Asking never fails the change that asked.
 */

const NOW: Date = new Date("2026-11-17T20:00:00.000Z");
const TASK_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const MAYA: DatabaseCommonInteractionProps = {
  userId: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001"),
  tenantId: PROJECT_ID,
};

let caseWrites: Array<JSONObject>;
let queued: Array<{
  queue: unknown;
  jobName: unknown;
  data: JSONObject;
  options: JSONObject;
}>;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
  caseWrites = [];
  queued = [];

  jest
    .spyOn(SecurityCaseService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown) => {
      caseWrites.push(args as JSONObject);
    }) as never);
  jest.spyOn(Queue, "addJob").mockImplementation((async (
    queue: unknown,
    _jobId: unknown,
    jobName: unknown,
    data: unknown,
    options: unknown,
  ) => {
    queued.push({
      queue,
      jobName,
      data: data as JSONObject,
      options: options as JSONObject,
    });
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("asking for a case's steps to be checked now", () => {
  test("moves the open case's next check to now, and queues one coalesced check a moment later", async () => {
    await SecurityCaseStepChecks.requestCheck({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(caseWrites).toEqual([
      {
        id: CASE_ID,
        data: { nextStepCheckAt: NOW },
        expectedData: { projectId: PROJECT_ID, closedAt: null },
        skipUpdateDateColumn: true,
      },
    ]);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      queue: QueueName.Worker,
      jobName: SECURITY_CASE_STEP_CHECK_JOB,
      data: {
        projectId: PROJECT_ID.toString(),
        securityCaseId: CASE_ID.toString(),
      },
      options: {
        delayInMs: SECURITY_CASE_STEP_CHECK_DELAY_MS,
        deduplication: {
          id: `security-case-step-check-${CASE_ID.toString()}`,
          keepLastIfActive: true,
        },
      },
    });
  });

  test("never fails the change that asked: a queue that is down leaves the case to the every-minute run", async () => {
    jest.spyOn(Queue, "addJob").mockRejectedValue(new Error("down") as never);

    await expect(
      SecurityCaseStepChecks.requestCheck({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).resolves.toBeUndefined();
    expect(caseWrites).toHaveLength(1);
  });
});

describe("the job", () => {
  test("checks every step of the case it names", async () => {
    const checkCaseNow: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseStepCheckRunner, "checkCaseNow")
      .mockResolvedValue({
        isClaimed: true,
        checkedStepKeys: [],
        regressedStepKeys: [],
        isContained: false,
      });

    await SecurityCaseStepChecks.runJob({
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
    });

    expect(checkCaseNow).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });
  });

  test("a job without its project or case is dropped", async () => {
    const checkCaseNow: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityCaseStepCheckRunner,
      "checkCaseNow",
    );

    await SecurityCaseStepChecks.runJob({ projectId: "nope" });

    expect(checkCaseNow).not.toHaveBeenCalled();
  });
});

describe("a task made from a Response Plan step", () => {
  type TaskHooks = {
    onCreateSuccess: (
      onCreate: OnCreate<SecurityCaseTask>,
      createdItem: SecurityCaseTask,
    ) => Promise<SecurityCaseTask>;
    onBeforeUpdate: (
      updateBy: UpdateBy<SecurityCaseTask>,
    ) => Promise<OnUpdate<SecurityCaseTask>>;
    onUpdateSuccess: (
      onUpdate: OnUpdate<SecurityCaseTask>,
      updatedItemIds: Array<ObjectID>,
    ) => Promise<OnUpdate<SecurityCaseTask>>;
  };
  const taskHooks: TaskHooks = SecurityCaseTaskService as unknown as TaskHooks;
  let asked: Array<JSONObject>;

  function task(responseStepKey?: string): SecurityCaseTask {
    const model: SecurityCaseTask = new SecurityCaseTask();
    model._id = TASK_ID.toString();
    model.projectId = PROJECT_ID;
    model.securityCaseId = CASE_ID;
    model.title = "Block 35.196.249.14 at your firewall, WAF or load balancer.";
    model.isDone = false;
    if (responseStepKey) {
      model.responseStepKey = responseStepKey;
    }
    return model;
  }

  beforeEach(() => {
    asked = [];
    jest
      .spyOn(SecurityCaseStepChecks, "requestCheck")
      .mockImplementation(async (args: unknown): Promise<void> => {
        asked.push(args as JSONObject);
      });
    jest
      .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(SecurityCaseNotifications, "taskAssigned")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectReferenceCheck, "validateUpdate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        SecurityCaseTaskService as unknown as {
          updateColumnsByIdWithoutHooks: () => Promise<void>;
        },
        "updateColumnsByIdWithoutHooks",
      )
      .mockResolvedValue(undefined as never);
  });

  test("ticked off where the plan suggests it: OneUptime checks the case's steps now", async () => {
    const created: SecurityCaseTask = task("contain:block-ip:35.196.249.14");

    await taskHooks.onCreateSuccess(
      { createBy: { data: created, props: MAYA }, carryForward: null },
      created,
    );

    expect(asked).toEqual([{ projectId: PROJECT_ID, securityCaseId: CASE_ID }]);
  });

  test("a task of the team's own, made from no step, asks for nothing", async () => {
    const created: SecurityCaseTask = task();

    await taskHooks.onCreateSuccess(
      { createBy: { data: created, props: MAYA }, carryForward: null },
      created,
    );

    expect(asked).toEqual([]);
  });

  test("opened again: OneUptime checks the case's steps now", async () => {
    const held: SecurityCaseTask = task("contain:block-ip:35.196.249.14");
    held.isDone = true;

    jest
      .spyOn(
        SecurityCaseTaskService as unknown as {
          findRowsAndHoldUpdateToThem: () => Promise<Array<SecurityCaseTask>>;
        },
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([held] as never);

    const onUpdate: OnUpdate<SecurityCaseTask> = await taskHooks.onBeforeUpdate(
      {
        query: { _id: TASK_ID },
        data: { isDone: false } as never,
        props: MAYA,
        limit: 1,
        skip: 0,
      },
    );
    await taskHooks.onUpdateSuccess(onUpdate, [TASK_ID]);

    expect(asked).toEqual([{ projectId: PROJECT_ID, securityCaseId: CASE_ID }]);
  });
});
