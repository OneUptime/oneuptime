import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallTestPageService, {
  ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE,
  getPreviewMethodsOfRule,
  getPreviewWarnings,
  getResultStatus,
  getStepStatus,
  toDelivery,
} from "../../../Server/Services/OnCallTestPageService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import SmsLogService from "../../../Server/Services/SmsLogService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import OnCallTestPageEvents from "../../../Server/Utils/OnCall/OnCallTestPageEvents";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import Name from "../../../Types/Name";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  ON_CALL_TEST_PAGES_PER_PROJECT_PER_HOUR,
  ON_CALL_TEST_PAGE_LIMIT_UNREADABLE_MESSAGE,
  ON_CALL_TEST_PAGE_PROJECT_LIMIT_MESSAGE,
  OnCallTestPageDeliveryStatus,
  OnCallTestPageFix,
  OnCallTestPageKind,
  OnCallTestPagePreview,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
  OnCallTestPageStepStatus,
  getOnCallTestPagePersonTooSoonMessage,
  getOnCallTestPagePolicyTooSoonMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import UserType from "../../../Types/UserType";
import {
  ProjectNotificationChannel,
  getProjectNotificationChannelOffMessage,
} from "../../../Utils/Project/NotificationChannels";
import { expectUserIdWhileMember } from "../TestingUtils/MembershipCondition";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * SENDING A TEST PAGE, AND WHAT BECAME OF IT (OnCallTestPageService).
 *
 * Who may send one (anybody to themselves; to a member, who may send them a
 * setup reminder), how often (a person every two minutes, a policy every
 * five, twenty a project an hour - refused while the shared cache cannot be
 * read), what it will send before it is sent, and the chain as it happened.
 */

const PROJECT: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000002");
const RUN: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000003");
const SEVERITY: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000004");
const RULE_1: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000005");
const TEAM: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000006");
const SCHEDULE: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000007");
const LINE_ANA: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000008");
const LINE_BOB: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000009");
const ANA: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-0000000000b1");
const CARA: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-0000000000c1");
const DAN: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-0000000000d1");

const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana Lopez",
  [BOB.toString()]: "Bob Stone",
  [CARA.toString()]: "Cara Diaz",
  [DAN.toString()]: "Dan Wu",
};

function memberProps(
  permissions: Array<Permission>,
  userId: ObjectID = ANA,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: userId,
    tenantId: PROJECT,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT.toString()]: tenantPermission,
    },
  };
}

let setIfNotExists: jest.SpyInstance;
let incrementIfBelow: jest.SpyInstance;
let deleteIfValue: jest.SpyInstance;
let sent: jest.SpyInstance;

beforeEach(() => {
  setIfNotExists = jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockResolvedValue(true as never);
  incrementIfBelow = jest
    .spyOn(GlobalCache, "incrementIfBelow")
    .mockResolvedValue(1 as never);
  deleteIfValue = jest
    .spyOn(GlobalCache, "deleteKeyIfValue")
    .mockResolvedValue(true as never);

  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockResolvedValue({ name: "Critical" } as never);
  jest
    .spyOn(AlertSeverityService, "findOneBy")
    .mockResolvedValue({ name: "High" } as never);
  jest
    .spyOn(IncidentSeverityService, "findOneById")
    .mockResolvedValue({ name: "Critical" } as never);
  jest
    .spyOn(AlertSeverityService, "findOneById")
    .mockResolvedValue({ name: "High" } as never);

  jest.spyOn(ProjectMembership, "isMember").mockResolvedValue(true as never);

  jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    const user: User = new User();
    user.id = data.id;
    user.name = new Name(NAMES[data.id.toString()] || "Someone");
    return user;
  }) as never);

  sent = jest
    .spyOn(OnCallTestPageEvents, "onTestPageSent")
    .mockImplementation(() => {
      return undefined;
    });

  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may send a test page to a member", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.OnCallAdmin,
    Permission.EditProjectOnCallDutyPolicy,
  ])("%s may", (permission: Permission) => {
    expect(() => {
      OnCallTestPageService.assertMaySendToMember(memberProps([permission]));
    }).not.toThrow();
  });

  test.each([
    Permission.ProjectMember,
    Permission.OnCallMember,
    Permission.Viewer,
  ])("%s may not: a test pages somebody else, under the project's name", (permission: Permission) => {
    expect(() => {
      OnCallTestPageService.assertMaySendToMember(memberProps([permission]));
    }).toThrow(ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE);
  });

  test("a master admin may", () => {
    expect(() => {
      OnCallTestPageService.assertMaySendToMember({
        isMasterAdmin: true,
        userId: ANA,
      });
    }).not.toThrow();
  });
});

describe("how often tests are sent", () => {
  const KEY: {
    namespace: string;
    id: ObjectID;
    intervalInSeconds: number;
    tooSoonMessage: string;
  } = {
    namespace: "oncall-test-page-person",
    id: BOB,
    intervalInSeconds: 120,
    tooSoonMessage: getOnCallTestPagePersonTooSoonMessage(120),
  };

  const NOW: Date = new Date("2026-11-11T09:30:00.000Z");
  const HOUR: number = Math.floor(NOW.getTime() / (60 * 60 * 1000));

  test("claims the person's window, then counts one of the project's hour", async () => {
    await OnCallTestPageService.claimLimits({
      projectId: PROJECT,
      key: KEY,
      now: NOW,
    });

    expect(setIfNotExists).toHaveBeenCalledTimes(1);
    expect(setIfNotExists.mock.calls[0]![0]).toBe("oncall-test-page-person");
    expect(setIfNotExists.mock.calls[0]![1]).toBe(
      `${PROJECT.toString()}:${BOB.toString()}`,
    );
    expect(setIfNotExists.mock.calls[0]![3]).toEqual({
      expiresInSeconds: 120,
    });
    expect(incrementIfBelow).toHaveBeenCalledWith(
      "oncall-test-page-project",
      `${PROJECT.toString()}:${HOUR}`,
      {
        limit: ON_CALL_TEST_PAGES_PER_PROJECT_PER_HOUR,
        expiresInSeconds: 3600,
      },
    );
    expect(ON_CALL_TEST_PAGES_PER_PROJECT_PER_HOUR).toBe(20);
    expect(deleteIfValue).not.toHaveBeenCalled();
  });

  test("a second test inside the window is refused with how long to wait, and counts nothing", async () => {
    setIfNotExists.mockResolvedValue(false as never);

    await expect(
      OnCallTestPageService.claimLimits({
        projectId: PROJECT,
        key: KEY,
        now: NOW,
      }),
    ).rejects.toThrow(new TooManyRequestsException(KEY.tooSoonMessage));
    expect(incrementIfBelow).not.toHaveBeenCalled();
  });

  test("the project's twenty-first test in an hour is refused, and hands its window back", async () => {
    incrementIfBelow.mockResolvedValue(null as never);

    await expect(
      OnCallTestPageService.claimLimits({
        projectId: PROJECT,
        key: KEY,
        now: NOW,
      }),
    ).rejects.toThrow(ON_CALL_TEST_PAGE_PROJECT_LIMIT_MESSAGE);

    // Only the window this call claimed: its own token.
    expect(deleteIfValue).toHaveBeenCalledTimes(1);
    expect(deleteIfValue.mock.calls[0]![0]).toBe("oncall-test-page-person");
    expect(deleteIfValue.mock.calls[0]![1]).toBe(
      `${PROJECT.toString()}:${BOB.toString()}`,
    );
    expect(deleteIfValue.mock.calls[0]![2]).toBe(
      setIfNotExists.mock.calls[0]![2],
    );
  });

  test("a cache that cannot be read refuses the test rather than sending it without a limit", async () => {
    setIfNotExists.mockRejectedValue(new Error("redis is down") as never);

    await expect(
      OnCallTestPageService.claimLimits({ projectId: PROJECT, key: KEY }),
    ).rejects.toThrow(ON_CALL_TEST_PAGE_LIMIT_UNREADABLE_MESSAGE);
  });

  test("a project count that cannot be read refuses it too, and hands the window back", async () => {
    incrementIfBelow.mockRejectedValue(new Error("redis is down") as never);

    await expect(
      OnCallTestPageService.claimLimits({ projectId: PROJECT, key: KEY }),
    ).rejects.toThrow(ON_CALL_TEST_PAGE_LIMIT_UNREADABLE_MESSAGE);
    expect(deleteIfValue).toHaveBeenCalledTimes(1);
  });

  test("refusals are 429s", async () => {
    setIfNotExists.mockResolvedValue(false as never);

    await expect(
      OnCallTestPageService.claimLimits({ projectId: PROJECT, key: KEY }),
    ).rejects.toBeInstanceOf(TooManyRequestsException);
  });
});

describe("sending a test page to a person", () => {
  let startTestPage: jest.SpyInstance;

  beforeEach(() => {
    startTestPage = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "startTestPage")
      .mockResolvedValue({
        executionLogId: RUN,
        outcome: { paged: [], notPaged: [], hadScheduleGap: false },
      } as never);
  });

  test("to themselves: one run paging them, credited to them, limited per person", async () => {
    await OnCallTestPageService.sendToPerson({
      projectId: PROJECT,
      targetUserId: ANA,
      sentByUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY,
    });

    expect(setIfNotExists.mock.calls[0]![0]).toBe("oncall-test-page-person");
    expect(setIfNotExists.mock.calls[0]![1]).toBe(
      `${PROJECT.toString()}:${ANA.toString()}`,
    );
    expect(setIfNotExists.mock.calls[0]![3]).toEqual({
      expiresInSeconds: 120,
    });
    expect(startTestPage).toHaveBeenCalledWith({
      projectId: PROJECT,
      userIds: [ANA],
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY,
      startedByUserId: ANA,
    });
    expect(sent).toHaveBeenCalledWith({
      projectId: PROJECT,
      executionLogId: RUN,
      sentByUserId: ANA,
      kind: OnCallTestPageKind.Self,
      recordKind: OnCallTestPageRecordKind.Incident,
    });
  });

  test("to a member: their window, and recorded as a member's test", async () => {
    await OnCallTestPageService.sendToPerson({
      projectId: PROJECT,
      targetUserId: BOB,
      sentByUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Alert,
      severityId: SEVERITY,
    });

    expect(setIfNotExists.mock.calls[0]![1]).toBe(
      `${PROJECT.toString()}:${BOB.toString()}`,
    );
    expect(startTestPage.mock.calls[0]![0]).toMatchObject({
      userIds: [BOB],
      startedByUserId: ANA,
    });
    expect(sent.mock.calls[0]![0]).toMatchObject({
      kind: OnCallTestPageKind.Member,
    });
  });

  test("somebody who is not a member of the project is refused before anything is counted", async () => {
    (ProjectMembership.isMember as unknown as jest.Mock).mockResolvedValue(
      false as never,
    );

    await expect(
      OnCallTestPageService.sendToPerson({
        projectId: PROJECT,
        targetUserId: DAN,
        sentByUserId: ANA,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(setIfNotExists).not.toHaveBeenCalled();
    expect(startTestPage).not.toHaveBeenCalled();
  });

  test("a severity of another project is refused before anything is counted", async () => {
    jest
      .spyOn(IncidentSeverityService, "findOneBy")
      .mockResolvedValue(null as never);

    await expect(
      OnCallTestPageService.sendToPerson({
        projectId: PROJECT,
        targetUserId: ANA,
        sentByUserId: ANA,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
      }),
    ).rejects.toThrow("Pick one of this project's incident severities.");
    expect(setIfNotExists).not.toHaveBeenCalled();
  });

  test("the severity is looked up in the project, of the kind tested", async () => {
    const alertRead: jest.SpyInstance = jest
      .spyOn(AlertSeverityService, "findOneBy")
      .mockResolvedValue(null as never);

    await expect(
      OnCallTestPageService.readSeverity({
        projectId: PROJECT,
        recordKind: OnCallTestPageRecordKind.Alert,
        severityId: SEVERITY,
      }),
    ).rejects.toThrow("Pick one of this project's alert severities.");

    expect(
      (alertRead.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({ _id: SEVERITY.toString(), projectId: PROJECT });
  });

  test("a refused test starts nothing", async () => {
    setIfNotExists.mockResolvedValue(false as never);

    await expect(
      OnCallTestPageService.sendToPerson({
        projectId: PROJECT,
        targetUserId: ANA,
        sentByUserId: ANA,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
      }),
    ).rejects.toBeInstanceOf(TooManyRequestsException);
    expect(startTestPage).not.toHaveBeenCalled();
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("testing a policy", () => {
  let startPolicyTest: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneBy")
      .mockResolvedValue({ id: POLICY, name: "Primary" } as never);
    startPolicyTest = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "startPolicyTest")
      .mockResolvedValue(RUN as never);
  });

  test("its window is five minutes a policy; the run walks every level only when asked", async () => {
    const id: ObjectID = await OnCallTestPageService.testPolicy({
      projectId: PROJECT,
      policyId: POLICY,
      sentByUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY,
      walksEscalation: true,
    });

    expect(id).toBe(RUN);
    expect(setIfNotExists.mock.calls[0]![0]).toBe("oncall-test-page-policy");
    expect(setIfNotExists.mock.calls[0]![1]).toBe(
      `${PROJECT.toString()}:${POLICY.toString()}`,
    );
    expect(setIfNotExists.mock.calls[0]![3]).toEqual({
      expiresInSeconds: 300,
    });
    expect(startPolicyTest).toHaveBeenCalledWith({
      projectId: PROJECT,
      onCallDutyPolicyId: POLICY,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY,
      walksEscalation: true,
      startedByUserId: ANA,
    });
    expect(sent.mock.calls[0]![0]).toMatchObject({
      kind: OnCallTestPageKind.Policy,
    });
  });

  test("tested again too soon, says how long to wait", async () => {
    setIfNotExists.mockResolvedValue(false as never);

    await expect(
      OnCallTestPageService.testPolicy({
        projectId: PROJECT,
        policyId: POLICY,
        sentByUserId: ANA,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
        walksEscalation: false,
      }),
    ).rejects.toThrow(getOnCallTestPagePolicyTooSoonMessage(300));
    expect(startPolicyTest).not.toHaveBeenCalled();
  });

  test("a policy of another project is not found", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneBy")
      .mockResolvedValue(null as never);

    await expect(
      OnCallTestPageService.testPolicy({
        projectId: PROJECT,
        policyId: POLICY,
        sentByUserId: ANA,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
        walksEscalation: false,
      }),
    ).rejects.toThrow(new BadDataException("On-call policy not found."));
    expect(setIfNotExists).not.toHaveBeenCalled();
  });
});

describe("what a test will send, before it is sent", () => {
  let rulesRead: jest.SpyInstance;

  function rule(
    id: string,
    notifyAfterMinutes: number,
    methods: Partial<UserNotificationRule>,
  ): UserNotificationRule {
    return {
      id: new ObjectID(id),
      notifyAfterMinutes: notifyAfterMinutes,
      ...methods,
    } as unknown as UserNotificationRule;
  }

  beforeEach(() => {
    rulesRead = jest
      .spyOn(UserNotificationRuleService, "findBy")
      .mockResolvedValue([
        rule("7e5ae000-0000-4000-8000-000000000101", 5, {
          userCall: { phone: new Phone("+15550101"), isVerified: true },
        } as never),
        rule("7e5ae000-0000-4000-8000-000000000102", 0, {
          userSms: { phone: new Phone("+15550100"), isVerified: true },
        } as never),
        rule("7e5ae000-0000-4000-8000-000000000103", 0, {
          userEmail: {
            email: new Email("ana@example.com"),
            isVerified: false,
          },
        } as never),
      ] as never);

    jest.spyOn(UserNotificationRuleService, "findOneBy").mockResolvedValue(
      null as never,
    );

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableSmsNotifications: true,
      enableCallNotifications: false,
      enableWhatsAppNotifications: true,
      enableTelegramNotifications: true,
      disableOnCallNotificationFallback: false,
    } as never);

    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);
  });

  test("for yourself: your methods for the severity, in the order a page reaches them, with where to", async () => {
    const preview: OnCallTestPagePreview =
      await OnCallTestPageService.getPreview({
        projectId: PROJECT,
        callerUserId: ANA,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
      });

    expect(preview.kind).toBe(OnCallTestPageKind.Self);
    expect(preview.people).toHaveLength(1);

    const person: OnCallTestPagePreview["people"][number] = preview.people[0]!;

    expect(person.userName).toBe("Ana Lopez");
    expect(
      person.methods.map((method: { channel: OnCallPageChannel }) => {
        return method.channel;
      }),
    ).toEqual([
      OnCallPageChannel.SMS,
      OnCallPageChannel.Email,
      OnCallPageChannel.Call,
    ]);
    expect(person.methods[0]!.address).toBe("+15550100");
    expect(person.methods[2]!.notifyAfterMinutes).toBe(5);
    expect(person.hasNoRule).toBe(false);
  });

  test("reads the rules a real page of the severity runs", async () => {
    await OnCallTestPageService.getPreview({
      projectId: PROJECT,
      callerUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Alert,
      severityId: SEVERITY,
    });

    const query: Record<string, unknown> = (
      rulesRead.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expectUserIdWhileMember(query["userId"], {
      userId: ANA,
      projectId: PROJECT,
    });
    expect(query["ruleType"]).toBe(NotificationRuleType.ON_CALL_EXECUTED_ALERT);
    expect(query["alertSeverityId"]).toBe(SEVERITY);
    expect(query["incidentSeverityId"]).toBeUndefined();
    expect(query["isOptOut"]).toBeDefined();
  });

  test("warns about what will not go out: an unverified method, a channel the project turned off", async () => {
    const preview: OnCallTestPagePreview =
      await OnCallTestPageService.getPreview({
        projectId: PROJECT,
        callerUserId: ANA,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
      });

    expect(preview.people[0]!.warnings).toEqual([
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.Call),
      "This Email method is not verified, so the test can't use it.",
    ]);
  });

  test("for a member: no addresses of theirs, and a member's kind", async () => {
    const preview: OnCallTestPagePreview =
      await OnCallTestPageService.getPreview({
        projectId: PROJECT,
        callerUserId: ANA,
        targetUserId: BOB,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
      });

    expect(preview.kind).toBe(OnCallTestPageKind.Member);
    expect(preview.people[0]!.userName).toBe("Bob Stone");

    for (const method of preview.people[0]!.methods) {
      expect(method.address).toBeUndefined();
    }
  });

  test("with no rule for the severity: like a real page, every verified method - or nothing, opted out", async () => {
    rulesRead.mockResolvedValue([] as never);

    let preview: OnCallTestPagePreview = await OnCallTestPageService.getPreview(
      {
        projectId: PROJECT,
        callerUserId: ANA,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
      },
    );

    expect(preview.people[0]!.hasNoRule).toBe(true);
    expect(preview.people[0]!.warnings[0]).toBe(
      "No on-call rule covers this severity: like a real page, the test goes to every verified method instead.",
    );

    jest
      .spyOn(UserNotificationRuleService, "findOneBy")
      .mockResolvedValue({ id: RULE_1 } as never);

    preview = await OnCallTestPageService.getPreview({
      projectId: PROJECT,
      callerUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY,
    });

    expect(preview.people[0]!.isOptedOut).toBe(true);
    expect(preview.people[0]!.warnings[0]).toBe(
      "Opted out of pages of this severity, so the test sends nothing.",
    );
  });

  test("its cost counts the texts and calls it sends", async () => {
    const preview: OnCallTestPagePreview =
      await OnCallTestPageService.getPreview({
        projectId: PROJECT,
        callerUserId: ANA,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
      });

    expect(preview.cost.smsCount).toBe(1);
    expect(preview.cost.callCount).toBe(1);
  });
});

describe("who a policy's first level pages right now", () => {
  beforeEach(() => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
      .mockResolvedValue([
        { id: RULE_1, order: 1 },
        { id: new ObjectID("7e5ae000-0000-4000-8000-000000000201"), order: 2 },
      ] as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
      .mockResolvedValue([
        { teamId: TEAM, team: { name: "Platform" } },
      ] as never);
    jest
      .spyOn(TeamMemberService, "getUsersInTeams")
      .mockResolvedValue([{ id: ANA }, { id: BOB }] as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
      .mockResolvedValue([{ userId: BOB }, { userId: DAN }] as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockResolvedValue([
        {
          onCallDutyPolicyScheduleId: SCHEDULE,
          onCallDutyPolicySchedule: { name: "Primary rotation" },
          pageNextInRotation: false,
        },
      ] as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentOnCallInSchedule")
      .mockResolvedValue({ userId: CARA } as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "getAwayOverride")
      .mockResolvedValue(null as never);

    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockResolvedValue(
        new Set<string>([
          ANA.toString().toLowerCase(),
          BOB.toString().toLowerCase(),
          CARA.toString().toLowerCase(),
        ]) as never,
      );
    (ProjectMembership.isMember as unknown as jest.Mock).mockImplementation(
      (async (data: { userId: ObjectID }) => {
        return data.userId.toString() !== DAN.toString();
      }) as never,
    );
  });

  test("each team's members, its people and who is on call, once each - and who it cannot reach, and why", async () => {
    const level: Awaited<
      ReturnType<typeof OnCallTestPageService.readFirstLevel>
    > = await OnCallTestPageService.readFirstLevel({
      projectId: PROJECT,
      policyId: POLICY,
    });

    expect(
      level.targets.map((target: { userId: ObjectID; reachedThrough?: string }) => {
        return [target.userId.toString(), target.reachedThrough];
      }),
    ).toEqual([
      [ANA.toString(), "Team Platform"],
      [BOB.toString(), "Team Platform"],
      [CARA.toString(), "Schedule Primary rotation"],
    ]);
    expect(level.notPaged).toEqual(["Dan Wu is not a member of this project."]);
    expect(level.levelCount).toBe(2);
  });

  test("somebody away with a cover is paged through who covers them; away with nobody covering, is said", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "getAwayOverride")
      .mockImplementation((async (data: { userId: ObjectID }) => {
        if (data.userId.toString() === ANA.toString()) {
          return { coverUserId: CARA, endsAt: new Date("2026-11-12T09:00:00Z") };
        }

        if (data.userId.toString() === BOB.toString()) {
          return { coverUserId: null, endsAt: new Date("2026-11-12T09:00:00Z") };
        }

        return null;
      }) as never);

    const level: Awaited<
      ReturnType<typeof OnCallTestPageService.readFirstLevel>
    > = await OnCallTestPageService.readFirstLevel({
      projectId: PROJECT,
      policyId: POLICY,
    });

    expect(level.targets[0]).toEqual({
      userId: CARA,
      reachedThrough: "Covering for Ana Lopez",
    });
    expect(level.notPaged).toContainEqual(
      expect.stringMatching(/^Bob Stone is away until .+, with nobody covering\.$/),
    );
  });

  test("a schedule with nobody on call, and a team with nobody in it, are said", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentOnCallInSchedule")
      .mockResolvedValue(null as never);
    jest
      .spyOn(TeamMemberService, "getUsersInTeams")
      .mockResolvedValue([] as never);

    const level: Awaited<
      ReturnType<typeof OnCallTestPageService.readFirstLevel>
    > = await OnCallTestPageService.readFirstLevel({
      projectId: PROJECT,
      policyId: POLICY,
    });

    expect(level.notPaged).toEqual(
      expect.arrayContaining([
        "Team Platform has no members.",
        "Nobody is on call in schedule Primary rotation now.",
      ]),
    );
  });

  test("a policy with no escalation rules pages nobody, and says so", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
      .mockResolvedValue([] as never);

    expect(
      await OnCallTestPageService.readFirstLevel({
        projectId: PROJECT,
        policyId: POLICY,
      }),
    ).toEqual({
      targets: [],
      notPaged: [
        "This policy has no escalation rules yet, so a test pages nobody.",
      ],
      levelCount: 0,
    });
  });
});

describe("what became of a test: the chain as it happened", () => {
  let runRead: jest.SpyInstance;

  function line(
    id: ObjectID,
    userId: ObjectID,
    status: OnCallDutyExecutionLogTimelineStatus,
  ): OnCallDutyPolicyExecutionLogTimeline {
    return {
      id: id,
      status: status,
      statusMessage: "",
      alertSentToUserId: userId,
      alertSentToUser: { name: new Name(NAMES[userId.toString()]!) },
      userBelongsToTeam: { name: "Platform" },
      onCallDutyPolicyEscalationRule: { name: "First", order: 1 },
    } as unknown as OnCallDutyPolicyExecutionLogTimeline;
  }

  function delivery(data: {
    id: string;
    userId: ObjectID;
    lineId: ObjectID;
    sms?: boolean;
    status: UserNotificationStatus;
    statusMessage?: string;
    sentAt: string;
    acknowledgedAt?: string;
  }): UserOnCallLogTimeline {
    return {
      id: new ObjectID(data.id),
      userId: data.userId,
      onCallDutyPolicyExecutionLogTimelineId: data.lineId,
      status: data.status,
      statusMessage: data.statusMessage || "",
      createdAt: new Date(data.sentAt),
      acknowledgedAt: data.acknowledgedAt
        ? new Date(data.acknowledgedAt)
        : undefined,
      isAcknowledged: Boolean(data.acknowledgedAt),
      ...(data.sms
        ? {
            userSmsId: new ObjectID("7e5ae000-0000-4000-8000-000000000301"),
            userSms: { phone: new Phone("+15550100") },
          }
        : {
            userEmailId: new ObjectID("7e5ae000-0000-4000-8000-000000000302"),
            userEmail: { email: new Email("bob@example.com") },
          }),
    } as unknown as UserOnCallLogTimeline;
  }

  beforeEach(() => {
    runRead = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneBy")
      .mockResolvedValue({
        id: RUN,
        projectId: PROJECT,
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage:
          "Test page acknowledged by Ana Lopez by SMS after 14 seconds.",
        createdAt: new Date("2026-11-11T09:00:00.000Z"),
        userNotificationEventType: UserNotificationEventType.TestPage,
        testPageRecordKind: OnCallTestPageRecordKind.Incident,
        testPageSeverityId: SEVERITY,
        testPageWalksEscalation: false,
        createdByUserId: DAN,
        acknowledgedAt: new Date("2026-11-11T09:00:14.000Z"),
        acknowledgedByUserId: ANA,
        acknowledgedByUser: { name: new Name("Ana Lopez") },
        onCallDutyPolicyId: POLICY,
        onCallDutyPolicy: { name: "Primary" },
      } as never);

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockResolvedValue([
        line(
          LINE_ANA,
          ANA,
          OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        ),
        line(LINE_BOB, BOB, OnCallDutyExecutionLogTimelineStatus.Error),
      ] as never);

    jest.spyOn(UserOnCallLogTimelineService, "findBy").mockResolvedValue([
      delivery({
        id: "7e5ae000-0000-4000-8000-000000000401",
        userId: ANA,
        lineId: LINE_ANA,
        sms: true,
        status: UserNotificationStatus.Acknowledged,
        sentAt: "2026-11-11T09:00:00.000Z",
        acknowledgedAt: "2026-11-11T09:00:14.000Z",
      }),
      delivery({
        id: "7e5ae000-0000-4000-8000-000000000402",
        userId: BOB,
        lineId: LINE_BOB,
        status: UserNotificationStatus.Error,
        statusMessage:
          "Email notification not sent because email bob@example.com is not verified.",
        sentAt: "2026-11-11T09:00:01.000Z",
      }),
    ] as never);

    jest.spyOn(SmsLogService, "findBy").mockResolvedValue([] as never);
  });

  test("a policy's test, acknowledged: by whom, by what, and how long after their message", async () => {
    const result: OnCallTestPageResult = await OnCallTestPageService.getResult({
      projectId: PROJECT,
      executionLogId: RUN,
      props: memberProps([], DAN),
    });

    expect(result).toMatchObject({
      executionLogId: RUN.toString(),
      kind: OnCallTestPageKind.Policy,
      policyId: POLICY.toString(),
      policyName: "Primary",
      recordKind: OnCallTestPageRecordKind.Incident,
      severityName: "Critical",
      walksEscalation: false,
      status: OnCallTestPageStatus.Acknowledged,
      startedAt: "2026-11-11T09:00:00.000Z",
      endsAt: "2026-11-11T09:15:00.000Z",
      acknowledgedByName: "Ana Lopez",
      acknowledgedChannel: OnCallPageChannel.SMS,
      acknowledgedAfterSeconds: 14,
    });
  });

  test("each step, with its messages, and where a message that did not go out is fixed", async () => {
    const result: OnCallTestPageResult = await OnCallTestPageService.getResult({
      projectId: PROJECT,
      executionLogId: RUN,
      props: { isRoot: true },
    });

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({
      status: OnCallTestPageStepStatus.Acknowledged,
      userName: "Ana Lopez",
      teamName: "Platform",
      levelOrder: 1,
      levelName: "First",
    });
    expect(result.steps[0]!.deliveries[0]).toMatchObject({
      channel: OnCallPageChannel.SMS,
      status: OnCallTestPageDeliveryStatus.Acknowledged,
      address: "+15550100",
      canAcknowledge: true,
    });
    expect(result.steps[1]!.status).toBe(OnCallTestPageStepStatus.Failed);
    expect(result.steps[1]!.deliveries[0]).toMatchObject({
      channel: OnCallPageChannel.Email,
      status: OnCallTestPageDeliveryStatus.Failed,
      fix: OnCallTestPageFix.NotificationMethods,
    });
  });

  test("who sent it may read it, as may who it paged", async () => {
    await expect(
      OnCallTestPageService.getResult({
        projectId: PROJECT,
        executionLogId: RUN,
        props: memberProps([], DAN),
      }),
    ).resolves.toBeDefined();

    await expect(
      OnCallTestPageService.getResult({
        projectId: PROJECT,
        executionLogId: RUN,
        props: memberProps([], BOB),
      }),
    ).resolves.toBeDefined();
  });

  test("somebody else needs to be allowed to read the project's execution logs", async () => {
    await expect(
      OnCallTestPageService.getResult({
        projectId: PROJECT,
        executionLogId: RUN,
        props: memberProps([], CARA),
      }),
    ).rejects.toThrow(ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE);

    await expect(
      OnCallTestPageService.getResult({
        projectId: PROJECT,
        executionLogId: RUN,
        props: memberProps([Permission.OnCallViewer], CARA),
      }),
    ).resolves.toBeDefined();
  });

  test("a run that is not a test page, or of another project, is not found", async () => {
    runRead.mockResolvedValue({
      id: RUN,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
    } as never);

    await expect(
      OnCallTestPageService.getResult({
        projectId: PROJECT,
        executionLogId: RUN,
        props: { isRoot: true },
      }),
    ).rejects.toThrow("Test page not found.");

    expect(
      (runRead.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({ _id: RUN.toString(), projectId: PROJECT });
  });

  test("a test of people is yours when it paged only you, a member's when it paged somebody else", async () => {
    runRead.mockResolvedValue({
      id: RUN,
      status: OnCallDutyPolicyStatus.Executing,
      createdAt: new Date("2026-11-11T09:00:00.000Z"),
      userNotificationEventType: UserNotificationEventType.TestPage,
      testPageRecordKind: OnCallTestPageRecordKind.Incident,
      testPageSeverityId: SEVERITY,
      createdByUserId: ANA,
    } as never);

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockResolvedValue([
        line(LINE_ANA, ANA, OnCallDutyExecutionLogTimelineStatus.NotificationSent),
      ] as never);

    let result: OnCallTestPageResult = await OnCallTestPageService.getResult({
      projectId: PROJECT,
      executionLogId: RUN,
      props: memberProps([], ANA),
    });

    expect(result.kind).toBe(OnCallTestPageKind.Self);
    expect(result.status).toBe(OnCallTestPageStatus.Paging);
    expect(result.policyId).toBeUndefined();

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockResolvedValue([
        line(LINE_BOB, BOB, OnCallDutyExecutionLogTimelineStatus.NotificationSent),
      ] as never);

    result = await OnCallTestPageService.getResult({
      projectId: PROJECT,
      executionLogId: RUN,
      props: memberProps([], ANA),
    });

    expect(result.kind).toBe(OnCallTestPageKind.Member);
  });

  test("a text the provider says reached the phone reads Delivered", async () => {
    jest
      .spyOn(SmsLogService, "findBy")
      .mockResolvedValue([
        {
          userOnCallLogTimelineId: new ObjectID(
            "7e5ae000-0000-4000-8000-000000000401",
          ),
        },
      ] as never);
    runRead.mockResolvedValue({
      id: RUN,
      status: OnCallDutyPolicyStatus.Executing,
      createdAt: new Date("2026-11-11T09:00:00.000Z"),
      userNotificationEventType: UserNotificationEventType.TestPage,
      testPageRecordKind: OnCallTestPageRecordKind.Incident,
      testPageSeverityId: SEVERITY,
      createdByUserId: ANA,
    } as never);
    jest.spyOn(UserOnCallLogTimelineService, "findBy").mockResolvedValue([
      delivery({
        id: "7e5ae000-0000-4000-8000-000000000401",
        userId: ANA,
        lineId: LINE_ANA,
        sms: true,
        status: UserNotificationStatus.Sent,
        sentAt: "2026-11-11T09:00:00.000Z",
      }),
    ] as never);

    const result: OnCallTestPageResult = await OnCallTestPageService.getResult({
      projectId: PROJECT,
      executionLogId: RUN,
      props: { isRoot: true },
    });

    expect(result.steps[0]!.deliveries[0]!.status).toBe(
      OnCallTestPageDeliveryStatus.Delivered,
    );
  });
});

describe("the result's words, from the records", () => {
  test("where a test stands, from its run", () => {
    expect(
      getResultStatus({
        status: OnCallDutyPolicyStatus.Completed,
        acknowledgedAt: new Date(),
      }),
    ).toBe(OnCallTestPageStatus.Acknowledged);
    expect(getResultStatus({ status: OnCallDutyPolicyStatus.Executing })).toBe(
      OnCallTestPageStatus.Paging,
    );
    expect(getResultStatus({ status: OnCallDutyPolicyStatus.Started })).toBe(
      OnCallTestPageStatus.Paging,
    );
    expect(getResultStatus({ status: OnCallDutyPolicyStatus.Error })).toBe(
      OnCallTestPageStatus.Failed,
    );
    expect(getResultStatus({ status: OnCallDutyPolicyStatus.Completed })).toBe(
      OnCallTestPageStatus.Ended,
    );
    expect(
      getResultStatus({
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      }),
    ).toBe(OnCallTestPageStatus.Ended);
  });

  test("what became of a step, from its line", () => {
    expect(
      getStepStatus(
        OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
      ),
    ).toBe(OnCallTestPageStepStatus.Acknowledged);
    expect(getStepStatus(OnCallDutyExecutionLogTimelineStatus.Skipped)).toBe(
      OnCallTestPageStepStatus.Skipped,
    );
    expect(getStepStatus(OnCallDutyExecutionLogTimelineStatus.Error)).toBe(
      OnCallTestPageStepStatus.Failed,
    );
    expect(
      getStepStatus(OnCallDutyExecutionLogTimelineStatus.NotificationSent),
    ).toBe(OnCallTestPageStepStatus.Paged);
  });

  test("a push can't be acknowledged from, and a skipped message says where it is fixed", () => {
    const push: UserOnCallLogTimeline = {
      id: new ObjectID("7e5ae000-0000-4000-8000-000000000501"),
      userPushId: new ObjectID("7e5ae000-0000-4000-8000-000000000502"),
      userPush: { deviceName: "Pixel" },
      status: UserNotificationStatus.Skipped,
      statusMessage:
        "Push notification not sent: this device no longer receives push notifications. Open the mobile app on it to register it again.",
      createdAt: new Date("2026-11-11T09:00:00.000Z"),
    } as unknown as UserOnCallLogTimeline;

    expect(toDelivery({ delivery: push, isDelivered: false })).toMatchObject({
      channel: OnCallPageChannel.Push,
      address: "Pixel",
      canAcknowledge: false,
      fix: OnCallTestPageFix.NotificationMethods,
      sentAt: "2026-11-11T09:00:00.000Z",
    });
  });

  test("a preview shows where to only to the person it is for", () => {
    const rule: UserNotificationRule = {
      notifyAfterMinutes: 0,
      userSms: { phone: new Phone("+15550100"), isVerified: true },
      userWebhook: { name: "Pager bridge" },
    } as unknown as UserNotificationRule;

    expect(getPreviewMethodsOfRule({ rule: rule, showAddresses: true })).toEqual([
      {
        channel: OnCallPageChannel.SMS,
        notifyAfterMinutes: 0,
        isVerified: true,
        canAcknowledge: true,
        address: "+15550100",
      },
      {
        channel: OnCallPageChannel.Webhook,
        notifyAfterMinutes: 0,
        isVerified: true,
        canAcknowledge: false,
        address: "Pager bridge",
      },
    ]);

    for (const method of getPreviewMethodsOfRule({
      rule: rule,
      showAddresses: false,
    })) {
      expect(method.address).toBeUndefined();
    }
  });

  test("a project that does not fall back says the test sends nothing", () => {
    expect(
      getPreviewWarnings({
        methods: [],
        project: { disableOnCallNotificationFallback: true } as never,
        hasNoRule: true,
        isOptedOut: false,
      }),
    ).toEqual([
      "No on-call rule covers this severity, and this project does not fall back to verified methods: the test sends nothing.",
    ]);
  });
});
