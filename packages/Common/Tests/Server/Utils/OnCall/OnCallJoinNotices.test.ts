import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import logger from "../../../../Server/Utils/Logger";
import OnCallJoinNotices from "../../../../Server/Utils/OnCall/OnCallJoinNotices";
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
  SECONDARY,
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
 * SOMEONE WHO JOINED IS TOLD, ONCE FOR EACH POLICY, OF THE RULES THAT PAGE
 * THEM FROM NOW ON (#10557).
 *
 * An escalation rule may name someone only invited, or a team they are
 * invited to, and pages them once they join (#10412); a rule that names a
 * team pages whoever joins it. Their time logs started then, and pages
 * reached them, but nothing told them: "You have been added to the on-call
 * policy ..." was said only when a rule's row was added. Here the policies
 * are kept in memory (EscalationRuleReachWorld) and OnCallJoinNotices is
 * asked what someone who joined hears: one message for each policy, naming
 * every rule of it that started paging them, and nothing of a rule that
 * paged them already.
 */

const POLICY_LINK: string = "https://oneuptime.test/policies/1";

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

async function joinedProject(userId: ObjectID): Promise<void> {
  await OnCallJoinNotices.tellJoined({
    projectId: PROJECT_ID,
    userId: userId,
    join: { membershipId: null },
  });
}

async function joinedTeam(
  userId: ObjectID,
  membership: WorldMembership,
): Promise<void> {
  await OnCallJoinNotices.tellJoined({
    projectId: PROJECT_ID,
    userId: userId,
    join: { membershipId: membership.id },
  });
}

describe("someone who joined the project", () => {
  test("REGRESSION: accepting the invitation a rule waited for tells them, once for each policy that pages them now", async () => {
    world.addMember(IVY, PLATFORM, false);
    world.namePerson(IVY);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);
    world.nameTeam(PLATFORM, OTHER_POLICY_RULE_ID);

    // While only invited: nothing.
    await joinedProject(IVY);
    expect(sent).toEqual([]);

    world.accept(IVY);
    await joinedProject(IVY);

    // It was nothing: they learned they were on call from their first page.
    expect(subjects()).toEqual([
      "You have been added to the on-call policy Checkout",
      "You have been added to the on-call policy Payments",
    ]);

    const payments: Sent = sent[1]!;
    expect(payments.eventType).toBe(
      NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
    );
    expect(payments.policyId).toBe(POLICY_ID.toString());
    // Logged against the first of its rules.
    expect(payments.ruleId).toBe(RULE_ID.toString());
    expect(payments.email.templateType).toBe(
      EmailTemplateType.UserAddedToOnCallPolicy,
    );
    expect(payments.email.vars).toMatchObject({
      onCallPolicyName: "Payments",
      escalationRuleName: "Level 1 and Level 2",
      escalationRuleOrder: "1 and 2",
      hasSeveralEscalationRules: "true",
      onCallPolicyViewLink: POLICY_LINK,
    });
    expect(sent[0]!.email.vars).toMatchObject({
      onCallPolicyName: "Checkout",
      escalationRuleName: "First line",
      escalationRuleOrder: "1",
    });
    expect(sent[0]!.email.vars["hasSeveralEscalationRules"]).toBeUndefined();
  });

  test("what each of their channels says: email, text, call, push and WhatsApp", async () => {
    world.addMember(IVY, PLATFORM, true);
    world.namePerson(IVY);

    await joinedProject(IVY);

    expect(sent).toHaveLength(1);

    const [message] = sent as [Sent];

    expect(message.email.subject).toBe(
      "You have been added to the on-call policy Payments",
    );
    expect(message.email.isSubjectLiteral).toBe(true);
    expect(message.email.vars["reason"]).toBe(
      "You have joined the project, so this on-call policy pages you from now on.",
    );
    expect(message.sms).toContain(
      "You have been added to the on-call policy Payments for escalation rule Level 1 with order 1, now that you have joined the project.",
    );
    expect(message.call).toBe(
      "This is a message from OneUptime. You have been added to the on-call policy Payments for escalation rule Level 1 with order 1, now that you have joined the project. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye",
    );
    expect(message.push.title).toBe("Added to On-Call Policy");
    expect(message.push.body).toBe(
      "You have been added to the on-call policy Payments.",
    );
    expect(message.whatsApp.templateVariables).toEqual({
      on_call_policy_name: "Payments",
      on_call_context: "escalation rule Level 1",
      policy_link: POLICY_LINK,
    });
  });

  test("several rules of a policy: their text and call name every one", async () => {
    world.addMember(IVY, PLATFORM, true);
    world.namePerson(IVY);
    world.namePerson(IVY, OTHER_RULE_ID);

    await joinedProject(IVY);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.sms).toContain(
      "for escalation rules Level 1 and Level 2 with orders 1 and 2, now that you have joined the project.",
    );
    expect(sent[0]!.whatsApp.templateVariables?.["on_call_context"]).toBe(
      "escalation rules Level 1 and Level 2",
    );
  });

  test("on call now on the roster of a schedule a rule pages: the message says so - its hand-off told them nothing while they were invited", async () => {
    world.addMember(IVY, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.roster.set(PRIMARY.toString(), IVY);

    await joinedProject(IVY);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.email.vars["reason"]).toBe(
      "You have joined the project, so this on-call policy pages you from now on. You are on call now on the roster of schedule Primary.",
    );
  });

  test("a rule that pages the next in a schedule's rotation does not count them on call", async () => {
    world.addMember(IVY, PLATFORM, true);
    world.nameSchedule(PRIMARY, { pageNextInRotation: true });
    world.roster.set(PRIMARY.toString(), IVY);

    await joinedProject(IVY);

    expect(sent).toEqual([]);
  });

  test("their rules each once, in their order, however many ways they page them", async () => {
    world.addMember(IVY, PLATFORM, true);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);
    world.namePerson(IVY, OTHER_RULE_ID);
    world.namePerson(IVY);
    world.nameSchedule(SECONDARY);
    world.roster.set(SECONDARY.toString(), IVY);

    await joinedProject(IVY);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.email.vars).toMatchObject({
      escalationRuleName: "Level 1 and Level 2",
      escalationRuleOrder: "1 and 2",
    });
    expect(sent[0]!.email.vars["reason"]).toContain(
      "You are on call now on the roster of schedule Secondary.",
    );
  });

  test("nothing pages them: nothing is sent", async () => {
    world.addMember(IVY, PLATFORM, true);

    await joinedProject(IVY);

    expect(sent).toEqual([]);
  });

  test("a rule removed meanwhile is left out, and a policy left with none sends nothing", async () => {
    world.addMember(IVY, PLATFORM, true);
    world.namePerson(IVY);
    world.namePerson(IVY, OTHER_POLICY_RULE_ID);
    world.rules.delete(OTHER_POLICY_RULE_ID.toString().toLowerCase());

    await joinedProject(IVY);

    expect(subjects()).toEqual([
      "You have been added to the on-call policy Payments",
    ]);
  });
});

describe("a member who joined another team", () => {
  test("REGRESSION: a team named on several rules of one policy is one message for it, naming them all", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);

    await joinedTeam(ANA, platform);

    expect(subjects()).toEqual([
      "You have been added to the on-call policy Payments for team Platform",
    ]);
    expect(sent[0]!.email.vars).toMatchObject({
      escalationRuleName: "Level 1 and Level 2",
      escalationRuleOrder: "1 and 2",
      hasSeveralEscalationRules: "true",
      reason:
        "You have joined the team Platform, so this on-call policy pages you from now on.",
    });
    expect(sent[0]!.sms).toContain(
      "You have been added to the on-call policy Payments for team Platform and escalation rules Level 1 and Level 2 with orders 1 and 2, now that you are a member of the team.",
    );
    expect(sent[0]!.whatsApp.templateVariables?.["on_call_context"]).toBe(
      "team Platform",
    );
  });

  test("a team on rules of two policies: one message for each", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_POLICY_RULE_ID);

    await joinedTeam(ANA, platform);

    expect(subjects()).toEqual([
      "You have been added to the on-call policy Checkout for team Platform",
      "You have been added to the on-call policy Payments for team Platform",
    ]);
    expect(sent[0]!.policyId).toBe(OTHER_POLICY_ID.toString());
  });

  test("a rule that named them already is left out; when every one did, nothing is sent", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);

    await joinedTeam(ANA, platform);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.email.vars).toMatchObject({
      escalationRuleName: "Level 2",
      escalationRuleOrder: "2",
    });

    sent = [];
    world.namePerson(ANA, OTHER_RULE_ID);

    await joinedTeam(ANA, platform);

    expect(sent).toEqual([]);
  });

  test("a rule another team of theirs put them on is no news", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PAYMENTS_TEAM);
    world.nameTeam(PLATFORM);

    await joinedTeam(ANA, platform);

    expect(sent).toEqual([]);
  });

  test("on call in one of its schedules, they are still told of the team's rule: a shift is not a lasting place on it", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), ANA);
    world.nameTeam(PLATFORM);

    await joinedTeam(ANA, platform);

    expect(subjects()).toEqual([
      "You have been added to the on-call policy Payments for team Platform",
    ]);
  });

  test("a team on no rule tells nothing", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PAYMENTS_TEAM);

    await joinedTeam(ANA, platform);

    expect(sent).toEqual([]);
  });

  test("SCIM adding several people to a team named on a rule: each is told once, of their own", async () => {
    const joins: Array<[ObjectID, WorldMembership]> = [];

    for (const userId of [ANA, BO, CY]) {
      world.addMember(userId, PAYMENTS_TEAM, true);
    }

    for (const userId of [ANA, BO, CY]) {
      joins.push([userId, world.addMember(userId, PLATFORM, true)]);
    }

    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);

    for (const [userId, membership] of joins) {
      await joinedTeam(userId, membership);
    }

    expect(
      sent.map((message: Sent): string => {
        return message.userId;
      }),
    ).toEqual([ANA.toString(), BO.toString(), CY.toString()]);
  });
});

describe("what goes wrong", () => {
  test("a read that fails sends nothing, is logged, and is never thrown", async () => {
    world.addMember(IVY, PLATFORM, true);
    world.namePerson(IVY);
    world.failReads = true;

    await expect(joinedProject(IVY)).resolves.toBeUndefined();

    expect(sent).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "Could not tell somebody who joined a project or a team which on-call policies page them now.",
      expect.anything(),
    );
  });

  test("one policy's message that cannot be sent keeps the others from failing", async () => {
    world.addMember(IVY, PLATFORM, true);
    world.namePerson(IVY);
    world.namePerson(IVY, OTHER_POLICY_RULE_ID);

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

    await expect(joinedProject(IVY)).resolves.toBeUndefined();

    // Checkout's failed; Payments' went.
    expect(subjects()).toEqual([
      "You have been added to the on-call policy Payments",
    ]);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("getOnCallNowText", () => {
  test("one schedule, several, and none", () => {
    expect(OnCallJoinNotices.getOnCallNowText(["Primary"])).toBe(
      " You are on call now on the roster of schedule Primary.",
    );
    expect(
      OnCallJoinNotices.getOnCallNowText(["Primary", "Secondary", "Primary"]),
    ).toBe(
      " You are on call now on the rosters of schedules Primary and Secondary.",
    );
    expect(OnCallJoinNotices.getOnCallNowText([])).toBe("");
    expect(OnCallJoinNotices.getOnCallNowText([" "])).toBe(
      " You are on call now on the roster of schedule No name provided.",
    );
  });
});
