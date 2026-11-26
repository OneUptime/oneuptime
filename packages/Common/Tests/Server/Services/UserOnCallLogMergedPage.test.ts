import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Model from "../../../Models/DatabaseModels/UserOnCallLog";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ObjectID from "../../../Types/ObjectID";
import { getOnCallPageMergedMessage } from "../../../Types/OnCallDutyPolicy/OnCallPageMerge";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import OnCallPolicyIncidentRole, {
  PagedPerson,
  PagedPersonRoleOutcome,
} from "../../../Server/Utils/OnCall/OnCallPolicyIncidentRole";
import logger from "../../../Server/Utils/Logger";

/*
 * A PERSON'S LOG OF A PAGE MERGED INTO THEIR OPEN PAGE FROM ANOTHER POLICY'S
 * RUN (issue #7837, Types/OnCallDutyPolicy/OnCallPageMerge).
 *
 * It is written as a page's log is - what it is about, where it sits in its
 * run, whom it covers for - in status Already Paged, naming the page it
 * stands on. Its start runs no notification rule and invites nobody to the
 * record's channels again: the page it stands on reaches the person for
 * both, and its start did that. Every other page still starts Scheduled.
 */

const USER_ID: ObjectID = new ObjectID("78372000-0000-4000-8000-000000000001");
const PROJECT_ID: ObjectID = new ObjectID(
  "78372000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "78372000-0000-4000-8000-000000000003",
);
const RUN_ID: ObjectID = new ObjectID("78372000-0000-4000-8000-000000000004");
const POLICY_ID: ObjectID = new ObjectID(
  "78372000-0000-4000-8000-000000000005",
);
const RULE_ID: ObjectID = new ObjectID("78372000-0000-4000-8000-000000000006");
const TEAM_ID: ObjectID = new ObjectID("78372000-0000-4000-8000-000000000007");
const LINE_ID: ObjectID = new ObjectID("78372000-0000-4000-8000-000000000008");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "78372000-0000-4000-8000-000000000009",
);
const COVERED_USER_ID: ObjectID = new ObjectID(
  "78372000-0000-4000-8000-00000000000a",
);
const COVER_LOG_ID: ObjectID = new ObjectID(
  "78372000-0000-4000-8000-00000000000b",
);

const MESSAGE: string = getOnCallPageMergedMessage({ policyName: "Payments" });

let createLog: SpyInstance<typeof UserOnCallLogService.create>;
let workspaceRules: SpyInstance<
  typeof UserNotificationRuleService.runWorkspaceRulesForOnCallNotification
>;
let giveRole: SpyInstance<
  typeof OnCallPolicyIncidentRole.giveRoleToPagedPerson
>;

beforeEach(() => {
  createLog = jest
    .spyOn(UserOnCallLogService, "create")
    .mockResolvedValue({ id: ObjectID.generate() } as never);
  workspaceRules = jest
    .spyOn(
      UserNotificationRuleService,
      "runWorkspaceRulesForOnCallNotification",
    )
    .mockResolvedValue(undefined as never);
  // The incident role the paging policy gives (OnCallPolicyIncidentRole).
  giveRole = jest
    .spyOn(OnCallPolicyIncidentRole, "giveRoleToPagedPerson")
    .mockResolvedValue(PagedPersonRoleOutcome.Given);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The role is given without the page waiting for it: let it run.
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 5; turn++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

function observerRun(isObserver: boolean): void {
  jest
    .spyOn(UserNotificationRuleService, "isObserverRun" as never)
    .mockResolvedValue(isObserver as never);
}

function createdLog(): Model {
  return (createLog.mock.calls[0]![0] as { data: Model }).data;
}

describe("recording a merged page", () => {
  test("writes the person's log as a page's, Already Paged, naming the page it stands on", async () => {
    await UserNotificationRuleService.recordMergedPage(USER_ID, {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: RUN_ID,
      onCallPolicyId: POLICY_ID,
      onCallPolicyEscalationRuleId: RULE_ID,
      userBelongsToTeamId: TEAM_ID,
      onCallDutyPolicyExecutionLogTimelineId: LINE_ID,
      onCallScheduleId: SCHEDULE_ID,
      overridedByUserId: COVERED_USER_ID,
      mergedIntoUserOnCallLogId: COVER_LOG_ID,
      statusMessage: MESSAGE,
    });

    expect(createLog).toHaveBeenCalledTimes(1);
    expect(
      (createLog.mock.calls[0]![0] as { props: { isRoot: boolean } }).props
        .isRoot,
    ).toBe(true);

    const log: Model = createdLog();

    expect(log.status).toBe(UserNotificationExecutionStatus.AlreadyPaged);
    expect(log.statusMessage).toBe(MESSAGE);
    expect(log.mergedIntoUserOnCallLogId).toEqual(COVER_LOG_ID);
    expect(log.userId).toEqual(USER_ID);
    expect(log.projectId).toEqual(PROJECT_ID);
    expect(log.triggeredByIncidentId).toEqual(INCIDENT_ID);
    expect(log.userNotificationEventType).toBe(
      UserNotificationEventType.IncidentCreated,
    );
    expect(log.onCallDutyPolicyExecutionLogId).toEqual(RUN_ID);
    expect(log.onCallDutyPolicyId).toEqual(POLICY_ID);
    expect(log.onCallDutyPolicyEscalationRuleId).toEqual(RULE_ID);
    expect(log.userBelongsToTeamId).toEqual(TEAM_ID);
    expect(log.onCallDutyPolicyExecutionLogTimelineId).toEqual(LINE_ID);
    expect(log.onCallDutyScheduleId).toEqual(SCHEDULE_ID);
    expect(log.overridedByUserId).toEqual(COVERED_USER_ID);
  });

  test("invites nobody to the record's channels again: the page it stands on did", async () => {
    await UserNotificationRuleService.recordMergedPage(USER_ID, {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: RUN_ID,
      onCallPolicyId: POLICY_ID,
      mergedIntoUserOnCallLogId: COVER_LOG_ID,
      statusMessage: MESSAGE,
    });

    expect(workspaceRules).not.toHaveBeenCalled();
  });

  test("a page it does not merge still starts Scheduled, as every page did", async () => {
    jest
      .spyOn(UserNotificationRuleService, "isObserverRun" as never)
      .mockResolvedValue(false as never);

    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      {
        projectId: PROJECT_ID,
        triggeredByIncidentId: INCIDENT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
        onCallPolicyExecutionLogId: RUN_ID,
        onCallPolicyId: POLICY_ID,
      },
    );

    expect(createdLog().status).toBe(UserNotificationExecutionStatus.Scheduled);
    expect(createdLog().statusMessage).toBe("Scheduled");
    expect(createdLog().mergedIntoUserOnCallLogId).toBeUndefined();
  });
});

describe("the incident role the paging policy gives the person it pages", () => {
  const pageAbout: (record: {
    triggeredByIncidentId?: ObjectID;
    triggeredByIncidentEpisodeId?: ObjectID;
    triggeredByAlertId?: ObjectID;
    onCallPolicyId?: ObjectID | undefined;
  }) => Promise<void> = async (record: {
    triggeredByIncidentId?: ObjectID;
    triggeredByIncidentEpisodeId?: ObjectID;
    triggeredByAlertId?: ObjectID;
    onCallPolicyId?: ObjectID | undefined;
  }): Promise<void> => {
    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      {
        projectId: PROJECT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
        onCallPolicyExecutionLogId: RUN_ID,
        ...record,
        onCallPolicyId:
          "onCallPolicyId" in record ? record.onCallPolicyId : POLICY_ID,
      },
    );
    await settle();
  };

  test("a responder paged about an incident is given it, by the policy that paged them", async () => {
    observerRun(false);

    await pageAbout({ triggeredByIncidentId: INCIDENT_ID });

    expect(giveRole).toHaveBeenCalledTimes(1);
    expect(giveRole.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      onCallDutyPolicyId: POLICY_ID,
      userId: USER_ID,
      incidentId: INCIDENT_ID,
      incidentEpisodeId: undefined,
    } as PagedPerson);
  });

  test("paged about an incident episode: given it on the episode", async () => {
    observerRun(false);
    const episodeId: ObjectID = ObjectID.generate();

    await pageAbout({ triggeredByIncidentEpisodeId: episodeId });

    expect(giveRole).toHaveBeenCalledTimes(1);
    expect(giveRole.mock.calls[0]![0].incidentEpisodeId).toEqual(episodeId);
    expect(giveRole.mock.calls[0]![0].incidentId).toBeUndefined();
  });

  test("an observer is kept informed, not given a part: no role", async () => {
    observerRun(true);

    await pageAbout({ triggeredByIncidentId: INCIDENT_ID });

    expect(giveRole).not.toHaveBeenCalled();
  });

  test("a page about an alert gives no incident role", async () => {
    observerRun(false);

    await pageAbout({ triggeredByAlertId: ObjectID.generate() });

    expect(giveRole).not.toHaveBeenCalled();
  });

  test("a page sent to people directly names no policy: no role", async () => {
    observerRun(false);

    await pageAbout({
      triggeredByIncidentId: INCIDENT_ID,
      onCallPolicyId: undefined,
    });

    expect(giveRole).not.toHaveBeenCalled();
  });

  test("a role that cannot be given never fails the page: it is logged", async () => {
    observerRun(false);
    giveRole.mockRejectedValue(new Error("database is down"));
    const logged: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return;
      });

    await expect(
      pageAbout({ triggeredByIncidentId: INCIDENT_ID }),
    ).resolves.toBeUndefined();

    expect(createdLog().status).toBe(UserNotificationExecutionStatus.Scheduled);
    expect(logged).toHaveBeenCalled();
  });

  test("a merged page: the policy reached them too, so they are given its role", async () => {
    observerRun(false);

    await UserNotificationRuleService.recordMergedPage(USER_ID, {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: RUN_ID,
      onCallPolicyId: POLICY_ID,
      mergedIntoUserOnCallLogId: COVER_LOG_ID,
      statusMessage: MESSAGE,
    });
    await settle();

    expect(giveRole).toHaveBeenCalledTimes(1);
    expect(giveRole.mock.calls[0]![0]).toMatchObject({
      onCallDutyPolicyId: POLICY_ID,
      userId: USER_ID,
      incidentId: INCIDENT_ID,
    });
  });

  test("a merged observer's page: no role", async () => {
    observerRun(true);

    await UserNotificationRuleService.recordMergedPage(USER_ID, {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: RUN_ID,
      onCallPolicyId: POLICY_ID,
      mergedIntoUserOnCallLogId: COVER_LOG_ID,
      statusMessage: MESSAGE,
    });
    await settle();

    expect(giveRole).not.toHaveBeenCalled();
  });
});

// The service's protected hooks, without widening its public surface.
function callOnBeforeCreate(data: Model): Promise<OnCreate<Model>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (UserOnCallLogService as any).onBeforeCreate({
    data: data,
    props: { isRoot: true },
  } as unknown as CreateBy<Model>);
}

function callOnCreateSuccess(createdItem: Model): Promise<Model> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (UserOnCallLogService as any).onCreateSuccess(
    {
      createBy: { data: createdItem, props: { isRoot: true } },
      carryForward: null,
    },
    createdItem,
  );
}

describe("the log's own hooks", () => {
  test("a merged page keeps its status as it is written", async () => {
    const log: Model = new Model();
    log.status = UserNotificationExecutionStatus.AlreadyPaged;
    log.mergedIntoUserOnCallLogId = COVER_LOG_ID;

    const onCreate: OnCreate<Model> = await callOnBeforeCreate(log);

    expect(onCreate.createBy.data.status).toBe(
      UserNotificationExecutionStatus.AlreadyPaged,
    );
  });

  test.each([
    ["any other status", UserNotificationExecutionStatus.Executing, true],
    [
      "Already Paged without the page it stands on",
      UserNotificationExecutionStatus.AlreadyPaged,
      false,
    ],
  ])(
    "%s starts Scheduled, as every page did",
    async (
      _name: string,
      status: UserNotificationExecutionStatus,
      hasCover: boolean,
    ) => {
      const log: Model = new Model();
      log.status = status;

      if (hasCover) {
        log.mergedIntoUserOnCallLogId = COVER_LOG_ID;
      }

      const onCreate: OnCreate<Model> = await callOnBeforeCreate(log);

      expect(onCreate.createBy.data.status).toBe(
        UserNotificationExecutionStatus.Scheduled,
      );
    },
  );

  test("a merged page's start runs nothing: no status written, no rule counted, no line moved", async () => {
    const logUpdate: SpyInstance<typeof UserOnCallLogService.updateOneById> =
      jest
        .spyOn(UserOnCallLogService, "updateOneById")
        .mockResolvedValue(undefined as never);
    const ruleCount: SpyInstance<typeof UserNotificationRuleService.countBy> =
      jest.spyOn(UserNotificationRuleService, "countBy");
    const lineUpdate: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogTimelineService.updateOneById
    > = jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const log: Model = new Model();
    log.id = ObjectID.generate();
    log.status = UserNotificationExecutionStatus.AlreadyPaged;
    log.mergedIntoUserOnCallLogId = COVER_LOG_ID;
    log.triggeredByIncidentId = INCIDENT_ID;
    log.userNotificationEventType = UserNotificationEventType.IncidentCreated;

    expect(await callOnCreateSuccess(log)).toBe(log);
    expect(logUpdate).not.toHaveBeenCalled();
    expect(ruleCount).not.toHaveBeenCalled();
    expect(lineUpdate).not.toHaveBeenCalled();
  });
});
