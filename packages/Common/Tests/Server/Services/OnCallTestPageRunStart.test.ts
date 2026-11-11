import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import logger from "../../../Server/Utils/Logger";
import OnCallEscalationAdvance from "../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
  ON_CALL_TEST_PAGE_FIRST_LEVEL_REACHED_NOBODY_MESSAGE,
  ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_TEST_PAGE_STARTED_ELSEWHERE_MESSAGE,
  OnCallTestPageRecordKind,
  getOnCallTestPagePagingMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * STARTING A TEST PAGE (OnCallDutyPolicyExecutionLogService).
 *
 * A test is a run like any other, with no record and the Test Page event
 * type: startTestPage pages people as a direct page does, startPolicyTest
 * writes a run of the policy that pages its first level as a real run does.
 * Only OneUptime writes one - an API call or a workflow is told where to
 * send a test from - and none starts the customer's workflows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7e5a0000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "7e5a0000-0000-4000-8000-000000000002",
);
const RUN_ID: ObjectID = new ObjectID("7e5a0000-0000-4000-8000-000000000003");
const RULE_ID: ObjectID = new ObjectID("7e5a0000-0000-4000-8000-000000000004");
const SEVERITY_ID: ObjectID = new ObjectID(
  "7e5a0000-0000-4000-8000-000000000005",
);
const SENDER_ID: ObjectID = new ObjectID(
  "7e5a0000-0000-4000-8000-0000000000a1",
);
const BOB: ObjectID = new ObjectID("7e5a0000-0000-4000-8000-0000000000b1");
const CARA: ObjectID = new ObjectID("7e5a0000-0000-4000-8000-0000000000c1");

interface CreateArgs {
  data: OnCallDutyPolicyExecutionLog;
  props: { isRoot?: boolean; userId?: ObjectID };
}

interface UpdateArgs {
  id: ObjectID;
  data: { status?: OnCallDutyPolicyStatus; statusMessage?: string };
}

type Hooks = {
  onBeforeCreate: (createBy: unknown) => Promise<unknown>;
  onCreateSuccess: (
    onCreate: unknown,
    createdItem: OnCallDutyPolicyExecutionLog,
  ) => Promise<OnCallDutyPolicyExecutionLog>;
};

const hooks: Hooks = OnCallDutyPolicyExecutionLogService as unknown as Hooks;

function testPolicyRun(walksEscalation: boolean): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = RUN_ID;
  run.projectId = PROJECT_ID;
  run.onCallDutyPolicyId = POLICY_ID;
  run.status = OnCallDutyPolicyStatus.Scheduled;
  run.userNotificationEventType = UserNotificationEventType.TestPage;
  run.testPageRecordKind = OnCallTestPageRecordKind.Alert;
  run.testPageSeverityId = SEVERITY_ID;
  run.testPageWalksEscalation = walksEscalation;
  return run;
}

let createSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;

function updates(): Array<UpdateArgs["data"]> {
  return updateSpy.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as UpdateArgs).data;
  });
}

beforeEach(() => {
  jest.spyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue();

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = POLICY_ID;
  policy.isArchived = false;
  jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockResolvedValue(policy as never);

  createSpy = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "create")
    .mockImplementation((async (args: CreateArgs) => {
      args.data.id = RUN_ID;
      return args.data;
    }) as never);

  updateSpy = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
    .mockResolvedValue(undefined as never);

  jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
    return undefined;
  });

  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("only OneUptime writes a test page", () => {
  test("an API call or a workflow that writes one is told where to send a test from", async () => {
    await expect(
      hooks.onBeforeCreate({
        data: testPolicyRun(false),
        props: { tenantId: PROJECT_ID, userId: SENDER_ID },
      }),
    ).rejects.toThrow(ON_CALL_TEST_PAGE_STARTED_ELSEWHERE_MESSAGE);

    await expect(
      hooks.onBeforeCreate({
        data: testPolicyRun(false),
        props: { tenantId: PROJECT_ID, userId: SENDER_ID },
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("OneUptime's own write of one goes through", async () => {
    await expect(
      hooks.onBeforeCreate({
        data: testPolicyRun(false),
        props: { isRoot: true },
      }),
    ).resolves.toBeDefined();
  });

  test("a real run written by an API call is as it was", async () => {
    const run: OnCallDutyPolicyExecutionLog = testPolicyRun(false);
    run.userNotificationEventType = UserNotificationEventType.AlertCreated;
    run.triggeredByAlertId = new ObjectID(
      "7e5a0000-0000-4000-8000-000000000009",
    );

    await expect(
      hooks.onBeforeCreate({
        data: run,
        props: { tenantId: PROJECT_ID, userId: SENDER_ID },
      }),
    ).resolves.toBeDefined();
  });
});

describe("startTestPage: a test page to people", () => {
  let directPageSpy: jest.SpyInstance;

  beforeEach(() => {
    directPageSpy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startDirectPage")
      .mockResolvedValue({
        paged: [
          {
            userId: BOB,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          },
        ],
        notPaged: [],
        hadScheduleGap: false,
      } as never);
  });

  test("writes a run with no policy and no record, saying what it tests, credited to its sender", async () => {
    await OnCallDutyPolicyExecutionLogService.startTestPage({
      projectId: PROJECT_ID,
      userIds: [BOB],
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY_ID,
      startedByUserId: SENDER_ID,
    });

    const args: CreateArgs = createSpy.mock.calls[0]![0] as CreateArgs;

    expect(args.data.projectId).toBe(PROJECT_ID);
    expect(args.data.onCallDutyPolicyId).toBeUndefined();
    expect(args.data.triggeredByIncidentId).toBeUndefined();
    expect(args.data.triggeredByAlertId).toBeUndefined();
    expect(args.data.userNotificationEventType).toBe(
      UserNotificationEventType.TestPage,
    );
    expect(args.data.testPageRecordKind).toBe(
      OnCallTestPageRecordKind.Incident,
    );
    expect(args.data.testPageSeverityId).toBe(SEVERITY_ID);
    expect(args.props).toEqual({ isRoot: true, userId: SENDER_ID });
  });

  test("pages its people as a direct page does, with the test's event type", async () => {
    await OnCallDutyPolicyExecutionLogService.startTestPage({
      projectId: PROJECT_ID,
      userIds: [BOB, CARA],
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY_ID,
      startedByUserId: SENDER_ID,
    });

    expect(directPageSpy).toHaveBeenCalledTimes(1);
    expect(directPageSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      userNotificationEventType: UserNotificationEventType.TestPage,
      onCallPolicyExecutionLogId: RUN_ID,
      targets: {
        userIds: [BOB, CARA],
        teamIds: [],
        onCallScheduleIds: [],
      },
    });
  });

  test("is started, then paging, saying how many it paged - and hands back its run", async () => {
    const result: { executionLogId: ObjectID } =
      await OnCallDutyPolicyExecutionLogService.startTestPage({
        projectId: PROJECT_ID,
        userIds: [BOB],
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY_ID,
        startedByUserId: SENDER_ID,
      });

    expect(result.executionLogId).toEqual(RUN_ID);
    expect(updates()).toEqual([
      {
        status: OnCallDutyPolicyStatus.Started,
        statusMessage: "Paging started...",
      },
      {
        status: OnCallDutyPolicyStatus.Executing,
        statusMessage: getOnCallTestPagePagingMessage(1),
      },
    ]);
  });

  test("one that reached nobody is over at once, and says so", async () => {
    directPageSpy.mockResolvedValue({
      paged: [],
      notPaged: [],
      hadScheduleGap: false,
    } as never);

    await OnCallDutyPolicyExecutionLogService.startTestPage({
      projectId: PROJECT_ID,
      userIds: [BOB],
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY_ID,
      startedByUserId: SENDER_ID,
    });

    expect(updates()[1]).toEqual({
      status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      statusMessage: ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
    });
  });

  test("one that could not page is an error that says why, and the caller hears it", async () => {
    directPageSpy.mockRejectedValue(new Error("Paging is down.") as never);

    await expect(
      OnCallDutyPolicyExecutionLogService.startTestPage({
        projectId: PROJECT_ID,
        userIds: [BOB],
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY_ID,
        startedByUserId: SENDER_ID,
      }),
    ).rejects.toThrow("Paging is down.");

    expect(updates()[1]).toEqual({
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: "Paging is down.",
    });
  });

  test("needs somebody to page", async () => {
    await expect(
      OnCallDutyPolicyExecutionLogService.startTestPage({
        projectId: PROJECT_ID,
        userIds: [],
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY_ID,
        startedByUserId: SENDER_ID,
      }),
    ).rejects.toThrow("A test page needs somebody to page.");

    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("startPolicyTest: a test of an on-call policy", () => {
  test("writes a run of the policy, with no record, saying what it tests and whether it walks every level", async () => {
    const id: ObjectID = await OnCallDutyPolicyExecutionLogService.startPolicyTest(
      {
        projectId: PROJECT_ID,
        onCallDutyPolicyId: POLICY_ID,
        recordKind: OnCallTestPageRecordKind.Alert,
        severityId: SEVERITY_ID,
        walksEscalation: true,
        startedByUserId: SENDER_ID,
      },
    );

    expect(id).toEqual(RUN_ID);

    const args: CreateArgs = createSpy.mock.calls[0]![0] as CreateArgs;

    expect(args.data.onCallDutyPolicyId).toBe(POLICY_ID);
    expect(args.data.status).toBe(OnCallDutyPolicyStatus.Scheduled);
    expect(args.data.userNotificationEventType).toBe(
      UserNotificationEventType.TestPage,
    );
    expect(args.data.testPageRecordKind).toBe(OnCallTestPageRecordKind.Alert);
    expect(args.data.testPageSeverityId).toBe(SEVERITY_ID);
    expect(args.data.testPageWalksEscalation).toBe(true);
    expect(args.data.triggeredByIncidentId).toBeUndefined();
    expect(args.data.triggeredByAlertId).toBeUndefined();
    expect(args.props).toEqual({ isRoot: true, userId: SENDER_ID });
  });
});

describe("a test of a policy pages its first level as a real run does", () => {
  let startRuleSpy: jest.SpyInstance;
  let moveOnSpy: jest.SpyInstance;
  let reachSpy: jest.SpyInstance;

  beforeEach(() => {
    const firstRule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    firstRule.id = RULE_ID;

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(firstRule as never);

    startRuleSpy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
      .mockResolvedValue({
        paged: [
          {
            userId: BOB,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          },
        ],
        notPaged: [],
        hadScheduleGap: false,
        movesOnAtOnce: false,
      } as never);

    moveOnSpy = jest
      .spyOn(OnCallEscalationAdvance, "moveOnAtOnce")
      .mockResolvedValue(null as never);

    reachSpy = jest
      .spyOn(ProjectMilestoneService, "reachInBackground")
      .mockImplementation(() => {
        return undefined;
      });
  });

  test("a test of a policy is not the project's first on-call policy that ran (#6830)", async () => {
    await hooks.onCreateSuccess(
      { createBy: { props: { isRoot: true } }, carryForward: null },
      testPolicyRun(false),
    );

    expect(reachSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        milestone: ActivationMilestone.FirstOnCallPolicyExecuted,
      }),
    );
  });

  test("its first level is paged with the test's event type, about no record", async () => {
    await hooks.onCreateSuccess(
      { createBy: { props: { isRoot: true } }, carryForward: null },
      testPolicyRun(false),
    );

    expect(startRuleSpy).toHaveBeenCalledTimes(1);
    expect(startRuleSpy.mock.calls[0]![0]).toEqual(RULE_ID);
    expect(startRuleSpy.mock.calls[0]![1]).toEqual({
      projectId: PROJECT_ID,
      triggeredByIncidentId: undefined,
      triggeredByAlertId: undefined,
      triggeredByAlertEpisodeId: undefined,
      triggeredByIncidentEpisodeId: undefined,
      userNotificationEventType: UserNotificationEventType.TestPage,
      onCallPolicyExecutionLogId: RUN_ID,
      onCallPolicyId: POLICY_ID,
    });
    expect(updates()).toEqual([
      {
        status: OnCallDutyPolicyStatus.Started,
        statusMessage: "Execution started...",
      },
      {
        status: OnCallDutyPolicyStatus.Executing,
        statusMessage: ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
      },
    ]);
  });

  test("a first level that reached nobody ends a first-level test there, rather than paging the next level", async () => {
    startRuleSpy.mockResolvedValue({
      paged: [],
      notPaged: [],
      hadScheduleGap: true,
      movesOnAtOnce: true,
    } as never);

    await hooks.onCreateSuccess(
      { createBy: { props: { isRoot: true } }, carryForward: null },
      testPolicyRun(false),
    );

    expect(moveOnSpy).not.toHaveBeenCalled();
    expect(updates()[1]).toEqual({
      status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      statusMessage: ON_CALL_TEST_PAGE_FIRST_LEVEL_REACHED_NOBODY_MESSAGE,
    });
  });

  test("a test that walks every level moves on from an empty first level, as a real run does", async () => {
    startRuleSpy.mockResolvedValue({
      paged: [],
      notPaged: [],
      hadScheduleGap: true,
      movesOnAtOnce: true,
    } as never);

    await hooks.onCreateSuccess(
      { createBy: { props: { isRoot: true } }, carryForward: null },
      testPolicyRun(true),
    );

    expect(moveOnSpy).toHaveBeenCalledTimes(1);
    expect(moveOnSpy.mock.calls[0]![0]).toEqual({ runId: RUN_ID });
    expect(updates()[1]).toEqual({
      status: OnCallDutyPolicyStatus.Executing,
      statusMessage: ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
    });
  });

  test("a real run keeps its words (regression)", async () => {
    const run: OnCallDutyPolicyExecutionLog = testPolicyRun(false);
    run.userNotificationEventType = UserNotificationEventType.AlertCreated;
    run.triggeredByAlertId = new ObjectID(
      "7e5a0000-0000-4000-8000-000000000009",
    );
    // Its record's feed is another suite's (OnCallDutyPolicyRunWait).
    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService as unknown as {
          getPolicyLink: () => Promise<null>;
        },
        "getPolicyLink",
      )
      .mockResolvedValue(null);

    await hooks.onCreateSuccess(
      { createBy: { props: { isRoot: true } }, carryForward: null },
      run,
    );

    expect(startRuleSpy.mock.calls[0]![1]).toMatchObject({
      userNotificationEventType: UserNotificationEventType.AlertCreated,
    });
    expect(updates()).toContainEqual({
      status: OnCallDutyPolicyStatus.Executing,
      statusMessage: "First escalation rule executed...",
    });
    // A real run is the project's first on-call policy that ran.
    expect(reachSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      milestone: ActivationMilestone.FirstOnCallPolicyExecuted,
    });
  });
});

describe("a test page starts none of the customer's workflows", () => {
  let workflowSpy: jest.SpyInstance;

  beforeEach(() => {
    workflowSpy = jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
  });

  test("a test run's changes are not handed to workflows", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue({
        id: RUN_ID,
        userNotificationEventType: UserNotificationEventType.TestPage,
      } as never);

    await OnCallDutyPolicyExecutionLogService.onTriggerWorkflow(
      RUN_ID,
      PROJECT_ID,
      "on-create",
    );

    expect(workflowSpy).not.toHaveBeenCalled();
  });

  test("a real run's still are", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue({
        id: RUN_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
      } as never);

    await OnCallDutyPolicyExecutionLogService.onTriggerWorkflow(
      RUN_ID,
      PROJECT_ID,
      "on-update",
      { status: "Executing" },
    );

    expect(workflowSpy).toHaveBeenCalledTimes(1);
    expect(workflowSpy.mock.calls[0]).toEqual([
      RUN_ID,
      PROJECT_ID,
      "on-update",
      { status: "Executing" },
    ]);
  });

  test("a run that cannot be read is not taken for a test", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockRejectedValue(new Error("connection reset") as never);

    expect(
      await OnCallDutyPolicyExecutionLogService.isTestPageRun(RUN_ID),
    ).toBe(false);

    await OnCallDutyPolicyExecutionLogService.onTriggerWorkflow(
      RUN_ID,
      PROJECT_ID,
      "on-create",
    );

    expect(workflowSpy).toHaveBeenCalledTimes(1);
  });
});
