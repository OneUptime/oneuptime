import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import TeamService from "../../../../Server/Services/TeamService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import logger from "../../../../Server/Utils/Logger";
import EscalationRuleReach from "../../../../Server/Utils/OnCall/EscalationRuleReach";
import OnCallLeaveNotices, {
  OnCallLeaveNotice,
} from "../../../../Server/Utils/OnCall/OnCallLeaveNotices";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import URL from "../../../../Types/API/URL";
import { CallRequestMessage } from "../../../../Types/Call/CallRequest";
import { EmailEnvelope } from "../../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import PushNotificationMessage from "../../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../../Types/SMS/SMS";
import { WhatsAppMessagePayload } from "../../../../Types/WhatsApp/WhatsAppMessage";
import ReachWorld, {
  ANA,
  BO,
  CY,
  IVY,
  OTHER_POLICY_ID,
  OTHER_POLICY_RULE_ID,
  OTHER_RULE_ID,
  PAYMENTS_TEAM,
  PLATFORM,
  POLICY_ID,
  PRIMARY,
  PROJECT_ID,
  RULE_ID,
  WorldMembership,
} from "./EscalationRuleReachWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * SOMEONE WHO LEFT A TEAM IS TOLD, ONCE FOR EACH POLICY, WHEN NOTHING ON IT
 * PAGES THEM ANY MORE (#10587).
 *
 * Joining a team an escalation rule names tells the person which policies
 * page them now (OnCallJoinNotices, #10557). Leaving it - or being removed
 * from it, by a Project Admin, by SCIM Push Groups, with the team itself -
 * ended their pages and time logs through it, and nothing told them. Here
 * the policies are kept in memory (EscalationRuleReachWorld), a membership
 * is taken away as a delete takes it, and OnCallLeaveNotices is asked what
 * the person hears: one message for each policy that pages them through
 * nothing any more, naming every rule of it the teams they left had put
 * them on - and nothing while anything on it still pages them, or once they
 * are no member of the project at all.
 */

const POLICY_LINK: string = "https://oneuptime.test/policies/1";

// A team no rule names: what keeps someone in the project.
const SRE: ObjectID = new ObjectID("10587000-0000-4000-8000-0000000000b3");

interface Sent {
  userId: string;
  eventType: NotificationSettingEventType;
  policyId: string;
  ruleId: string;
  email: EmailEnvelope;
  sms: string;
  call: string;
  push: PushNotificationMessage;
  whatsApp: WhatsAppMessagePayload;
}

let world: ReachWorld;
let sent: Array<Sent>;

beforeEach(() => {
  world = new ReachWorld();
  world.install();
  world.names.set(SRE.toString().toLowerCase(), "SRE");
  sent = [];

  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString(POLICY_LINK));
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
      onCallPolicyId: ObjectID;
      onCallPolicyEscalationRuleId: ObjectID;
      emailEnvelope: EmailEnvelope;
      smsMessage: SMSMessage;
      callRequestMessage: CallRequestMessage;
      pushNotificationMessage: PushNotificationMessage;
      whatsAppMessage: WhatsAppMessagePayload;
    }) => {
      sent.push({
        userId: data.userId.toString(),
        eventType: data.eventType,
        policyId: data.onCallPolicyId.toString(),
        ruleId: data.onCallPolicyEscalationRuleId.toString(),
        email: data.emailEnvelope,
        sms: data.smsMessage.message,
        call: (data.callRequestMessage.data[0] as { sayMessage: string })
          .sayMessage,
        push: data.pushNotificationMessage,
        whatsApp: data.whatsAppMessage,
      });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function subjects(): Array<string> {
  return sent.map((message: Sent): string => {
    return message.email.subject;
  });
}

// A member of the project through SRE, which no rule names.
function inProject(userId: ObjectID): WorldMembership {
  return world.addMember(userId, SRE, true);
}

/*
 * One delete takes these memberships away - each person's, by team - and
 * the leave notices are told of it, as TeamMemberService.onDeleteSuccess
 * tells them.
 */
async function removed(...memberships: Array<WorldMembership>): Promise<void> {
  const teamsByUser: Map<
    string,
    { userId: ObjectID; teamIds: Array<ObjectID> }
  > = new Map();

  for (const membership of memberships) {
    world.leave(membership);

    const entry: { userId: ObjectID; teamIds: Array<ObjectID> } =
      teamsByUser.get(membership.userId.toString()) || {
        userId: membership.userId,
        teamIds: [],
      };

    entry.teamIds.push(membership.teamId);
    teamsByUser.set(membership.userId.toString(), entry);
  }

  await OnCallLeaveNotices.tellLeft({
    projectId: PROJECT_ID,
    leavers: [...teamsByUser.values()],
  });
}

describe("someone who left the only team a policy pages them through", () => {
  test("REGRESSION: leaving the team tells them, once for the policy, naming every rule it had put them on", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);

    await removed(platform);

    // It was nothing: they learned they were off the policy from their silent pager.
    expect(subjects()).toEqual([
      "You have been removed from the on-call policy Payments for team Platform",
    ]);

    const [message] = sent as [Sent];

    expect(message.userId).toBe(ANA.toString());
    expect(message.eventType).toBe(
      NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
    );
    expect(message.policyId).toBe(POLICY_ID.toString());
    // Logged against the first of its rules.
    expect(message.ruleId).toBe(RULE_ID.toString());
    expect(message.email.templateType).toBe(
      EmailTemplateType.UserRemovedFromOnCallPolicy,
    );
    expect(message.email.isSubjectLiteral).toBe(true);
    expect(message.email.vars).toEqual({
      onCallPolicyName: "Payments",
      escalationRuleName: "Level 1 and Level 2",
      escalationRuleOrder: "1 and 2",
      hasSeveralEscalationRules: "true",
      reason:
        "You are no longer a member of the team Platform, so this on-call policy no longer pages you.",
      onCallPolicyViewLink: POLICY_LINK,
    });
  });

  test("what each of their channels says: email, text, call, push and WhatsApp", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);

    await removed(platform);

    expect(sent).toHaveLength(1);

    const [message] = sent as [Sent];

    expect(message.email.vars["escalationRuleName"]).toBe("Level 1");
    expect(message.email.vars["escalationRuleOrder"]).toBe("1");
    expect(message.email.vars["hasSeveralEscalationRules"]).toBeUndefined();
    expect(message.sms).toContain(
      "You have been removed from the on-call policy Payments for team Platform and escalation rule Level 1 with order 1, now that you are no longer a member of the team.",
    );
    expect(message.call).toBe(
      "This is a message from OneUptime. You have been removed from the on-call policy Payments for team Platform and escalation rule Level 1 with order 1, now that you are no longer a member of the team. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye",
    );
    expect(message.push.title).toBe("Removed from On-Call Policy");
    expect(message.push.body).toBe(
      "You have been removed from the on-call policy Payments.",
    );
    expect(message.whatsApp.templateVariables).toEqual({
      on_call_policy_name: "Payments",
      on_call_context: "team Platform",
      policy_link: POLICY_LINK,
    });
  });

  test("several rules of the policy: their text and call name every one", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);
    world.nameTeam(PLATFORM);

    await removed(platform);

    expect(sent).toHaveLength(1);
    // In their order, whichever the rows came in.
    expect(sent[0]!.sms).toContain(
      "for team Platform and escalation rules Level 1 and Level 2 with orders 1 and 2, now that you are no longer a member of the team.",
    );
    expect(sent[0]!.ruleId).toBe(RULE_ID.toString());
  });

  test("nothing pages them any more: no time log is kept open - the team's ended with the membership", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);

    await removed(platform);

    expect(world.logsOf(ANA)).toEqual([]);
  });

  test("a team on rules of two policies: one message for each, by the policy's name", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_POLICY_RULE_ID);

    await removed(platform);

    expect(subjects()).toEqual([
      "You have been removed from the on-call policy Checkout for team Platform",
      "You have been removed from the on-call policy Payments for team Platform",
    ]);
    expect(sent[0]!.policyId).toBe(OTHER_POLICY_ID.toString());
    expect(sent[0]!.ruleId).toBe(OTHER_POLICY_RULE_ID.toString());
  });

  test("each policy speaks for itself: named in Checkout, they are told of Payments only", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_POLICY_RULE_ID);
    world.namePerson(ANA, OTHER_POLICY_RULE_ID);

    await removed(platform);

    expect(subjects()).toEqual([
      "You have been removed from the on-call policy Payments for team Platform",
    ]);
    // Checkout's name keeps its log open.
    expect(world.logsOf(ANA)).toEqual(["start named"]);
  });

  test("another policy's paths are no help to this one", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.namePerson(ANA, OTHER_POLICY_RULE_ID);

    await removed(platform);

    expect(subjects()).toEqual([
      "You have been removed from the on-call policy Payments for team Platform",
    ]);
  });
});

describe("leaving one of two teams, and every other overlap that keeps them on the policy", () => {
  test("REGRESSION: leaving one of two teams the rule names says nothing, and the other team's log stays open", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.addMember(ANA, PAYMENTS_TEAM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PAYMENTS_TEAM);

    await removed(platform);

    expect(sent).toEqual([]);
    expect(world.logsOf(ANA)).toEqual([
      `start team ${PAYMENTS_TEAM.toString()}`,
    ]);
  });

  test("the other team on another rule of the policy: nothing said either", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.addMember(ANA, PAYMENTS_TEAM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PAYMENTS_TEAM, OTHER_RULE_ID);

    await removed(platform);

    expect(sent).toEqual([]);
    expect(world.timeLogs).toEqual([
      {
        action: "start",
        userId: ANA.toString(),
        ruleId: OTHER_RULE_ID.toString(),
        teamId: PAYMENTS_TEAM.toString(),
        scheduleId: null,
      },
    ]);
  });

  test("leaving the other one after: told once, of the rules that team had put them on", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    const payments: WorldMembership = world.addMember(ANA, PAYMENTS_TEAM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PAYMENTS_TEAM, OTHER_RULE_ID);

    await removed(platform);
    expect(sent).toEqual([]);

    await removed(payments);

    expect(subjects()).toEqual([
      "You have been removed from the on-call policy Payments for team Payments team",
    ]);
    expect(sent[0]!.email.vars).toMatchObject({
      escalationRuleName: "Level 2",
      escalationRuleOrder: "2",
    });
  });

  test("and in the other order", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    const payments: WorldMembership = world.addMember(ANA, PAYMENTS_TEAM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PAYMENTS_TEAM, OTHER_RULE_ID);

    await removed(payments);
    expect(sent).toEqual([]);

    await removed(platform);

    expect(subjects()).toEqual([
      "You have been removed from the on-call policy Payments for team Platform",
    ]);
    expect(sent[0]!.email.vars).toMatchObject({
      escalationRuleName: "Level 1",
      escalationRuleOrder: "1",
    });
  });

  test("both teams in one delete: one message, naming both teams and every rule", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    const payments: WorldMembership = world.addMember(ANA, PAYMENTS_TEAM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PAYMENTS_TEAM, OTHER_RULE_ID);

    await removed(platform, payments);

    expect(subjects()).toEqual([
      "You have been removed from the on-call policy Payments for teams Platform and Payments team",
    ]);
    expect(sent[0]!.email.vars).toMatchObject({
      escalationRuleName: "Level 1 and Level 2",
      escalationRuleOrder: "1 and 2",
      hasSeveralEscalationRules: "true",
      reason:
        "You are no longer a member of the teams Platform and Payments team, so this on-call policy no longer pages you.",
    });
    expect(sent[0]!.sms).toContain(
      "for teams Platform and Payments team, and escalation rules Level 1 and Level 2 with orders 1 and 2, now that you are no longer a member of those teams.",
    );
    expect(sent[0]!.whatsApp.templateVariables?.["on_call_context"]).toBe(
      "teams Platform and Payments team",
    );
  });

  test("named on another rule of the policy: nothing said, and the name's log stays open", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    inProject(ANA);
    world.nameTeam(PLATFORM);
    world.namePerson(ANA, OTHER_RULE_ID);

    await removed(platform);

    expect(sent).toEqual([]);
    expect(world.logsOf(ANA)).toEqual(["start named"]);
  });

  test("named on the very rule that names the team: nothing said", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    inProject(ANA);
    world.nameTeam(PLATFORM);
    world.namePerson(ANA);

    await removed(platform);

    expect(sent).toEqual([]);
  });

  test("on call now in one of its schedules: nothing said - the hand-off that ends the shift says it - and the shift's log stays open", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    inProject(ANA);
    world.nameTeam(PLATFORM);
    world.nameSchedule(PRIMARY, { ruleId: OTHER_RULE_ID });
    world.onCall.set(PRIMARY.toString(), ANA);

    await removed(platform);

    expect(sent).toEqual([]);
    expect(world.logsOf(ANA)).toEqual([`start schedule ${PRIMARY.toString()}`]);
  });

  test("next in the rotation of a schedule the policy pages that way: still paged, nothing said, nothing logged", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    inProject(ANA);
    inProject(BO);
    world.nameTeam(PLATFORM);
    world.nameSchedule(PRIMARY, {
      ruleId: OTHER_RULE_ID,
      pageNextInRotation: true,
    });
    world.onCall.set(PRIMARY.toString(), BO);
    world.next.set(PRIMARY.toString(), ANA);

    await removed(platform);

    expect(sent).toEqual([]);
    expect(world.logsOf(ANA)).toEqual([]);
  });

  test("a team they were only invited to is no path: leaving the one they had joined tells them", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    inProject(ANA);
    world.addMember(ANA, PAYMENTS_TEAM, false);
    world.nameTeam(PLATFORM);
    world.nameTeam(PAYMENTS_TEAM);

    await removed(platform);

    expect(subjects()).toEqual([
      "You have been removed from the on-call policy Payments for team Platform",
    ]);
  });
});

describe("nobody is told who should not be", () => {
  test("REGRESSION: removed from the project - every team at once - they are told nothing, and no policy is read for them", async () => {
    const sre: WorldMembership = inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    const payments: WorldMembership = world.addMember(ANA, PAYMENTS_TEAM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PAYMENTS_TEAM, OTHER_POLICY_RULE_ID);

    const policyPaths: SpyInstance<
      typeof EscalationRuleReach.readPolicyPathsOfPerson
    > = jest.spyOn(EscalationRuleReach, "readPolicyPathsOfPerson");

    await removed(sre, platform, payments);

    // Nothing of the project reaches someone who has left it.
    expect(sent).toEqual([]);
    expect(policyPaths).not.toHaveBeenCalled();
    expect(world.timeLogs).toEqual([]);
  });

  test("leaving their only team leaves the project: told nothing either", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);

    await removed(platform);

    expect(sent).toEqual([]);
  });

  test("someone only invited, whose invitations are withdrawn, was never paged: told nothing", async () => {
    const platform: WorldMembership = world.addMember(IVY, PLATFORM, false);
    world.nameTeam(PLATFORM);

    await removed(platform);

    expect(sent).toEqual([]);
  });

  test("a team no rule names: one read, and nothing else", async () => {
    inProject(ANA);
    const payments: WorldMembership = world.addMember(ANA, PAYMENTS_TEAM, true);
    world.nameTeam(PLATFORM);

    await removed(payments);

    expect(sent).toEqual([]);
    expect(
      OnCallDutyPolicyEscalationRuleTeamService.findBy,
    ).toHaveBeenCalledTimes(1);
    expect(ProjectMembership.getMemberUserIds).not.toHaveBeenCalled();
  });

  test("a rule removed meanwhile is left out, and a policy left with none sends nothing", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_POLICY_RULE_ID);
    world.rules.delete(OTHER_POLICY_RULE_ID.toString().toLowerCase());

    await removed(platform);

    expect(subjects()).toEqual([
      "You have been removed from the on-call policy Payments for team Platform",
    ]);
  });
});

describe("many at once: SCIM, and a team deleted", () => {
  test("REGRESSION: SCIM removing several people from a team: each is told once, of their own - what they share read once", async () => {
    const platform: Array<WorldMembership> = [];

    for (const userId of [ANA, BO, CY]) {
      inProject(userId);
      platform.push(world.addMember(userId, PLATFORM, true));
    }

    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);

    await removed(...platform);

    expect(
      sent.map((message: Sent): string => {
        return `${message.userId}: ${message.email.subject}`;
      }),
    ).toEqual(
      [ANA, BO, CY].map((userId: ObjectID): string => {
        return `${userId.toString()}: You have been removed from the on-call policy Payments for team Platform`;
      }),
    );

    // The rules' names and the teams', once for the three of them.
    expect(OnCallDutyPolicyEscalationRuleService.findBy).toHaveBeenCalledTimes(
      1,
    );
    expect(TeamService.findBy).toHaveBeenCalledTimes(1);
    // What still pages each of them: once each.
    expect(
      jest
        .mocked(OnCallDutyPolicyEscalationRuleTeamService.findBy)
        .mock.calls.filter((call: Array<unknown>): boolean => {
          return (
            (call[0] as { query: Record<string, unknown> }).query[
              "onCallDutyPolicyId"
            ] !== undefined
          );
        }),
    ).toHaveLength(3);
  });

  test("one of them still paged by something else: only the others are told", async () => {
    const platform: Array<WorldMembership> = [];

    for (const userId of [ANA, BO, CY]) {
      inProject(userId);
      platform.push(world.addMember(userId, PLATFORM, true));
    }

    world.nameTeam(PLATFORM);
    world.namePerson(BO, OTHER_RULE_ID);

    await removed(...platform);

    expect(
      sent.map((message: Sent): string => {
        return message.userId;
      }),
    ).toEqual([ANA.toString(), CY.toString()]);
  });

  test("one of them removed from the project in the same delete: the others are told, they are not", async () => {
    inProject(ANA);
    inProject(CY);
    const platform: Array<WorldMembership> = [ANA, BO, CY].map(
      (userId: ObjectID): WorldMembership => {
        return world.addMember(userId, PLATFORM, true);
      },
    );
    world.nameTeam(PLATFORM);

    await removed(...platform);

    expect(
      sent.map((message: Sent): string => {
        return message.userId;
      }),
    ).toEqual([ANA.toString(), CY.toString()]);
  });
});

describe("what goes wrong", () => {
  test("a read that fails sends nothing, is logged, and is never thrown", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.leave(platform);
    world.failReads = true;

    await expect(
      OnCallLeaveNotices.tellLeft({
        projectId: PROJECT_ID,
        leavers: [{ userId: ANA, teamIds: [PLATFORM] }],
      }),
    ).resolves.toBeUndefined();

    expect(sent).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "Could not tell the people who left teams of a project which on-call policies stopped paging them.",
      expect.anything(),
    );
  });

  test("what still pages one of them could not be read: the others are told all the same", async () => {
    const platform: Array<WorldMembership> = [];

    for (const userId of [ANA, BO]) {
      inProject(userId);
      platform.push(world.addMember(userId, PLATFORM, true));
    }

    world.nameTeam(PLATFORM);

    const readPaths: typeof EscalationRuleReach.readPolicyPathsOfPerson =
      EscalationRuleReach.readPolicyPathsOfPerson.bind(EscalationRuleReach);

    jest
      .spyOn(EscalationRuleReach, "readPolicyPathsOfPerson")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          userId: ObjectID;
          policyIds: ReadonlyArray<ObjectID>;
        }) => {
          if (data.userId.toString() === ANA.toString()) {
            throw new Error("unreachable");
          }

          return await readPaths(data);
        },
      );

    await removed(...platform);

    // Ana is told nothing rather than something untrue; Bo is told.
    expect(
      sent.map((message: Sent): string => {
        return message.userId;
      }),
    ).toEqual([BO.toString()]);
    expect(logger.error).toHaveBeenCalledWith(
      "Could not tell somebody who left a team which on-call policies stopped paging them.",
      expect.anything(),
    );
  });

  test("one policy's message that cannot be sent keeps the others from failing", async () => {
    inProject(ANA);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_POLICY_RULE_ID);

    const send: SpyInstance<
      typeof UserNotificationSettingService.sendUserNotification
    > = jest.mocked(
      UserNotificationSettingService.sendUserNotification,
    ) as unknown as SpyInstance<
      typeof UserNotificationSettingService.sendUserNotification
    >;
    const recorded: unknown = send.getMockImplementation();
    send
      .mockRejectedValueOnce(new Error("the notification service is down"))
      .mockImplementation(recorded as never);

    await removed(platform);

    // Checkout's failed; Payments' went.
    expect(subjects()).toEqual([
      "You have been removed from the on-call policy Payments for team Platform",
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("nobody to tell about is no read at all", async () => {
    await OnCallLeaveNotices.tellLeft({ projectId: PROJECT_ID, leavers: [] });
    await OnCallLeaveNotices.tellLeft({
      projectId: PROJECT_ID,
      leavers: [{ userId: ANA, teamIds: [] }],
    });

    expect(
      OnCallDutyPolicyEscalationRuleTeamService.findBy,
    ).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});

describe("getNotices: each policy once, its rules in order and its teams by name", () => {
  function row(data: {
    policyId: ObjectID;
    ruleId: ObjectID;
    teamId: ObjectID;
  }): OnCallDutyPolicyEscalationRuleTeam {
    const model: OnCallDutyPolicyEscalationRuleTeam =
      new OnCallDutyPolicyEscalationRuleTeam();
    model._id = ObjectID.generate().toString();
    model.onCallDutyPolicyId = data.policyId;
    model.onCallDutyPolicyEscalationRuleId = data.ruleId;
    model.teamId = data.teamId;
    return model;
  }

  test("a rule named twice, a team named twice and a team with no name", () => {
    const ruleRows: Array<OnCallDutyPolicyEscalationRule> = [
      world.ruleModel(OTHER_RULE_ID),
      world.ruleModel(RULE_ID),
    ];
    const notices: Array<OnCallLeaveNotice> = OnCallLeaveNotices.getNotices({
      rows: [
        row({ policyId: POLICY_ID, ruleId: OTHER_RULE_ID, teamId: PLATFORM }),
        row({ policyId: POLICY_ID, ruleId: RULE_ID, teamId: PLATFORM }),
        row({ policyId: POLICY_ID, ruleId: RULE_ID, teamId: SRE }),
      ],
      ruleRows: ruleRows,
      teamNames: new Map<string, string>([
        [PLATFORM.toString().toLowerCase(), "Platform"],
        [SRE.toString().toLowerCase(), "  "],
      ]),
    });

    expect(notices).toHaveLength(1);
    expect(
      notices[0]!.rules.map((rule: { name: string }): string => {
        return rule.name;
      }),
    ).toEqual(["Level 1", "Level 2"]);
    expect(notices[0]!.teamNames).toEqual(["Platform", "No name provided"]);
    expect(notices[0]!.policyName).toBe("Payments");
  });
});
