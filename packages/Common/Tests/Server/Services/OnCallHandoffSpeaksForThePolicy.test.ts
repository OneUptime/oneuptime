import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import EscalationRuleReach from "../../../Server/Utils/OnCall/EscalationRuleReach";
import OnCallHandoffPosts from "../../../Server/Utils/OnCall/OnCallHandoffPosts";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import URL from "../../../Types/API/URL";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
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
  SECONDARY,
  readQueryValues,
} from "../Utils/OnCall/EscalationRuleReachWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * A SCHEDULE'S HAND-OFF SPEAKS FOR THE WHOLE POLICY (#10556).
 *
 * When someone's shift ends, the hand-off tells them "You are no longer
 * on-call for Payments" for each policy that pages the schedule. It said so
 * also while the policy still paged them - named on another of its rules,
 * an accepted member of one of its teams, on call in another of its
 * schedules - and since #10538 a rule's add and removal speak for the rule
 * as a whole, so the hand-off was the one message left about it, and a
 * wrong one. It also told someone only invited, put in a layer, that they
 * were on call, and logged them as on call for the policy, though nothing
 * pages them until they join.
 *
 * Driven here through the real hand-off
 * (sendNotificationToUserOnScheduleHandoff) over policies kept in memory
 * (EscalationRuleReachWorld): who is told what, and every on-call time log
 * started or ended, for every overlap - a direct name and a schedule, a
 * team and a schedule, two schedules, next in a rotation, a pending
 * invitee in a layer - and a shift ending in each.
 */

const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana",
  [BO.toString()]: "Bo",
  [CY.toString()]: "Cy",
  [IVY.toString()]: "Ivy",
};

const WORDS: Partial<Record<NotificationSettingEventType, string>> = {
  [NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER]:
    "no longer on call",
  [NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER]:
    "now on call",
  [NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER]:
    "next on call",
};

// A rule of Checkout that pages a schedule too.
const CHECKOUT_ESCALATE_ID: ObjectID = new ObjectID(
  "10556000-0000-4000-8000-0000000000e4",
);

const YESTERDAY: Date = new Date("2026-11-19T09:00:00.000Z");
const TODAY: Date = new Date("2026-11-20T09:00:00.000Z");
const TOMORROW: Date = new Date("2026-11-21T09:00:00.000Z");
const DAY_AFTER: Date = new Date("2026-11-22T09:00:00.000Z");

let world: ReachWorld;
// "Ana: no longer on call for Payments", in the order they were told.
let told: Array<string>;
let subjects: Array<string>;

beforeEach(() => {
  world = new ReachWorld();
  world.install();
  world.describeRule(CHECKOUT_ESCALATE_ID, {
    policyId: OTHER_POLICY_ID,
    name: "Escalate",
    order: 2,
  });

  told = [];
  subjects = [];

  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/policies/1"));
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
      onCallPolicyId: ObjectID;
      emailEnvelope: EmailEnvelope;
    }) => {
      told.push(
        `${NAMES[data.userId.toString()] || "?"}: ${WORDS[data.eventType] || data.eventType} for ${world.nameOf(data.onCallPolicyId)}`,
      );
      subjects.push(data.emailEnvelope.subject);
    }) as never);
  jest.spyOn(OnCallHandoffPosts, "post").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The schedule's shift moves from `from` to `to` - who was next - and
 * `next` is next now: the roster a page works out says `to` from here on.
 */
async function handoff(data: {
  scheduleId: ObjectID;
  from: ObjectID | null;
  to: ObjectID | null;
  next?: ObjectID | null;
}): Promise<void> {
  world.onCall.set(data.scheduleId.toString(), data.to);

  await (
    OnCallDutyPolicyScheduleService as unknown as {
      sendNotificationToUserOnScheduleHandoff: (data: {
        scheduleId: ObjectID;
        previousInformation: Record<string, unknown>;
        newInformation: Record<string, unknown>;
      }) => Promise<void>;
    }
  ).sendNotificationToUserOnScheduleHandoff({
    scheduleId: data.scheduleId,
    previousInformation: {
      currentUserIdOnRoster: data.from,
      rosterHandoffAt: TODAY,
      nextUserIdOnRoster: data.to,
      nextHandOffTimeAt: TOMORROW,
      rosterStartAt: YESTERDAY,
      nextRosterStartAt: TODAY,
    },
    newInformation: {
      currentUserIdOnRoster: data.to,
      rosterHandoffAt: data.to ? TOMORROW : null,
      nextUserIdOnRoster: data.next || null,
      nextHandOffTimeAt: DAY_AFTER,
      rosterStartAt: data.to ? TODAY : null,
      nextRosterStartAt: TOMORROW,
    },
  });
}

function members(...userIds: Array<ObjectID>): void {
  for (const userId of userIds) {
    world.addMember(userId, PAYMENTS_TEAM, true);
  }
}

describe("a direct name plus a schedule", () => {
  test("REGRESSION: named on another rule of the policy, their shift ending on its schedule says nothing of the policy", async () => {
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.namePerson(ANA, OTHER_RULE_ID);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    // It was "Ana: no longer on call for Payments" too.
    expect(told).toEqual(["Bo: now on call for Payments"]);
  });

  test("their shift's time log ends all the same; their name's log is not touched", async () => {
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.namePerson(ANA, OTHER_RULE_ID);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(world.logsOf(ANA)).toEqual([`end schedule ${PRIMARY.toString()}`]);
    expect(world.logsOf(BO)).toEqual([`start schedule ${PRIMARY.toString()}`]);
  });

  test("named on the very rule that pages the schedule: nothing said either", async () => {
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.namePerson(ANA);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(told).toEqual(["Bo: now on call for Payments"]);
  });

  test("named on nothing of the policy: told they are no longer on call, as ever", async () => {
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(told).toEqual([
      "Ana: no longer on call for Payments",
      "Bo: now on call for Payments",
    ]);
    expect(subjects[0]).toBe("You are no longer on-call for Payments");
  });

  test("each policy that pages the schedule speaks for itself: named in Payments, told of Checkout only", async () => {
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(PRIMARY, { ruleId: CHECKOUT_ESCALATE_ID });
    world.namePerson(ANA, OTHER_RULE_ID);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(told).toEqual([
      "Bo: now on call for Payments",
      "Ana: no longer on call for Checkout",
      "Bo: now on call for Checkout",
    ]);
    // Her shift's logs end for both policies' rules.
    expect(world.logsOf(ANA)).toEqual([
      `end schedule ${PRIMARY.toString()}`,
      `end schedule ${PRIMARY.toString()}`,
    ]);
  });
});

describe("a team plus a schedule", () => {
  test("an accepted member of one of the policy's teams: nothing said of the policy", async () => {
    world.addMember(ANA, PLATFORM, true);
    members(BO);
    world.nameSchedule(PRIMARY);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(told).toEqual(["Bo: now on call for Payments"]);
    expect(world.logsOf(ANA)).toEqual([`end schedule ${PRIMARY.toString()}`]);
  });

  test("a team on a rule of another policy keeps only that policy from telling", async () => {
    world.addMember(ANA, PLATFORM, true);
    members(BO);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(PRIMARY, { ruleId: CHECKOUT_ESCALATE_ID });
    world.nameTeam(PLATFORM, OTHER_POLICY_RULE_ID);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(told).toEqual([
      "Ana: no longer on call for Payments",
      "Bo: now on call for Payments",
      "Bo: now on call for Checkout",
    ]);
  });

  test("a team they were only invited to is not theirs: they are told", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    world.addMember(ANA, PLATFORM, false);
    members(BO);
    world.nameSchedule(PRIMARY);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(told).toEqual([
      "Ana: no longer on call for Payments",
      "Bo: now on call for Payments",
    ]);
  });
});

describe("two schedules", () => {
  test("on call in another of the policy's schedules: nothing said, until that shift ends too", async () => {
    members(ANA, BO, CY);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(SECONDARY, { ruleId: OTHER_RULE_ID });
    world.onCall.set(PRIMARY.toString(), ANA);
    world.onCall.set(SECONDARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(told).toEqual(["Bo: now on call for Payments"]);

    told = [];

    await handoff({ scheduleId: SECONDARY, from: ANA, to: CY });

    expect(told).toEqual([
      "Ana: no longer on call for Payments",
      "Cy: now on call for Payments",
    ]);
    // Each shift's log ended with it.
    expect(world.logsOf(ANA)).toEqual([
      `end schedule ${PRIMARY.toString()}`,
      `end schedule ${SECONDARY.toString()}`,
    ]);
  });

  test("next in the rotation of a schedule the policy pages that way: still paged, nothing said", async () => {
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(PRIMARY, {
      ruleId: OTHER_RULE_ID,
      pageNextInRotation: true,
    });
    world.onCall.set(PRIMARY.toString(), ANA);
    world.next.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO, next: ANA });

    // Next on call, as the roster says - and not "no longer on call".
    expect(told).toEqual([
      "Bo: now on call for Payments",
      "Ana: next on call for Payments",
    ]);
  });

  test("another policy's schedule has them on call: no help to this one", async () => {
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(SECONDARY, { ruleId: OTHER_POLICY_RULE_ID });
    world.onCall.set(PRIMARY.toString(), ANA);
    world.onCall.set(SECONDARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(told).toEqual([
      "Ana: no longer on call for Payments",
      "Bo: now on call for Payments",
    ]);
  });
});

describe("a pending invitee in a layer", () => {
  test("REGRESSION: coming on call, someone only invited is told nothing and logged nowhere", async () => {
    world.addMember(IVY, PLATFORM, false);
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);

    await handoff({ scheduleId: PRIMARY, from: BO, to: IVY });

    // It was "Ivy: now on call for Payments", and her on-call time log started.
    expect(told).toEqual(["Bo: no longer on call for Payments"]);
    expect(world.logsOf(IVY)).toEqual([]);
    expect(world.logsOf(BO)).toEqual([`end schedule ${PRIMARY.toString()}`]);
  });

  test("their shift ending tells them nothing either, and closes whatever an earlier hand-off left open", async () => {
    world.addMember(IVY, PLATFORM, false);
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), IVY);

    await handoff({ scheduleId: PRIMARY, from: IVY, to: BO });

    expect(told).toEqual(["Bo: now on call for Payments"]);
    expect(world.logsOf(IVY)).toEqual([`end schedule ${PRIMARY.toString()}`]);
    // And no policy was read for them: nothing pages them to read.
    expect(
      jest
        .mocked(OnCallDutyPolicyEscalationRuleUserService.findBy)
        .mock.calls.filter((call: Array<unknown>): boolean => {
          return Boolean(
            readQueryValues(
              (call[0] as { query: Record<string, unknown> }).query["userId"],
            )?.includes(IVY.toString()),
          );
        }),
    ).toEqual([]);
  });

  test("next in the rotation, someone only invited is not told so", async () => {
    world.addMember(IVY, PLATFORM, false);
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO, next: IVY });

    expect(told).toEqual([
      "Ana: no longer on call for Payments",
      "Bo: now on call for Payments",
    ]);
  });

  test("someone who has left the project is told nothing and logged nowhere, as an invitee", async () => {
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);

    await handoff({ scheduleId: PRIMARY, from: BO, to: CY, next: CY });

    expect(told).toEqual(["Bo: no longer on call for Payments"]);
    expect(world.logsOf(CY)).toEqual([]);
  });

  test("once they join, the hand-off tells and logs them as anyone", async () => {
    world.addMember(IVY, PLATFORM, false);
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);
    world.accept(IVY);

    await handoff({ scheduleId: PRIMARY, from: BO, to: IVY });

    expect(told).toEqual([
      "Bo: no longer on call for Payments",
      "Ivy: now on call for Payments",
    ]);
    expect(world.logsOf(IVY)).toEqual([`start schedule ${PRIMARY.toString()}`]);
  });
});

describe("what the hand-off reads", () => {
  test("who is a member is read once, and what still pages whoever's shift ended once for every policy", async () => {
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(PRIMARY, { ruleId: CHECKOUT_ESCALATE_ID });
    world.namePerson(ANA, OTHER_RULE_ID);
    world.onCall.set(PRIMARY.toString(), ANA);

    const policyPaths: SpyInstance<
      typeof EscalationRuleReach.readPolicyPathsOfPerson
    > = jest.spyOn(EscalationRuleReach, "readPolicyPathsOfPerson");

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO, next: CY });

    expect(policyPaths).toHaveBeenCalledTimes(1);
    expect(policyPaths.mock.calls[0]![0]).toMatchObject({
      userId: ANA,
      policyIds: [POLICY_ID, OTHER_POLICY_ID],
    });
    // The hand-off's read of who is a member, and the policies' of Ana.
    expect(ProjectMembership.getMemberUserIds).toHaveBeenCalledTimes(2);
    expect(
      jest.mocked(ProjectMembership.getMemberUserIds).mock.calls[0]![0],
    ).toMatchObject({ userIds: [ANA, BO, CY] });
  });

  test("the same person staying on call reads no policy: nobody's shift ended", async () => {
    members(ANA);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), ANA);

    const policyPaths: SpyInstance<
      typeof EscalationRuleReach.readPolicyPathsOfPerson
    > = jest.spyOn(EscalationRuleReach, "readPolicyPathsOfPerson");

    await handoff({ scheduleId: PRIMARY, from: ANA, to: ANA, next: BO });

    expect(policyPaths).not.toHaveBeenCalled();
  });

  test("who is a member could not be read: everyone is told and logged as before", async () => {
    world.addMember(IVY, PLATFORM, false);
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);
    jest
      .mocked(ProjectMembership.getMemberUserIds)
      .mockRejectedValue(new Error("unreachable") as never);

    await handoff({ scheduleId: PRIMARY, from: BO, to: IVY });

    expect(told).toEqual([
      "Bo: no longer on call for Payments",
      "Ivy: now on call for Payments",
    ]);
    expect(world.logsOf(IVY)).toEqual([`start schedule ${PRIMARY.toString()}`]);
  });

  test("what still pages them could not be read: they are told as before", async () => {
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.namePerson(ANA, OTHER_RULE_ID);
    world.onCall.set(PRIMARY.toString(), ANA);
    jest
      .spyOn(EscalationRuleReach, "readPolicyPathsOfPerson")
      .mockRejectedValue(new Error("unreachable"));

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(told).toEqual([
      "Ana: no longer on call for Payments",
      "Bo: now on call for Payments",
    ]);
  });

  test("a schedule only a next-in-rotation rule pages reads nothing and tells nobody", async () => {
    members(ANA, BO);
    world.nameSchedule(PRIMARY, { pageNextInRotation: true });
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ scheduleId: PRIMARY, from: ANA, to: BO });

    expect(told).toEqual([]);
    expect(ProjectMembership.getMemberUserIds).not.toHaveBeenCalled();
  });
});
