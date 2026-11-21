import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import EscalationRuleReach from "../../../Server/Utils/OnCall/EscalationRuleReach";
import OnCallJoinNotices from "../../../Server/Utils/OnCall/OnCallJoinNotices";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import URL from "../../../Types/API/URL";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import { NotificationRuleUpdateKind } from "../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import ReachWorld, {
  ANA,
  BO,
  CY,
  IVY,
  OTHER_POLICY_ID,
  PAYMENTS_TEAM,
  PLATFORM,
  PRIMARY,
  PROJECT_ID,
} from "../Utils/OnCall/EscalationRuleReachWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A SCHEDULE'S HAND-OFF ANNOUNCES WHO IS PAGED (#10586), END TO END.
 *
 * Driven through the real hand-off (sendNotificationToUserOnScheduleHandoff)
 * and the real posts (OnCallHandoffPosts) over policies kept in memory
 * (EscalationRuleReachWorld): what the policy's feed and its Slack channel
 * hear, who is told what, and every time log, when the rotation reaches
 * someone only invited - on call, next, joining during the shift - and for
 * two policies, someone who left, and a read that fails.
 */

const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana",
  [BO.toString()]: "Bo",
  [CY.toString()]: "Cy",
  // As the project knows her while only invited: the address she was invited at.
  [IVY.toString()]: "ivy@acme.test",
};

const WORDS: Partial<Record<NotificationSettingEventType, string>> = {
  [NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER]:
    "no longer on call",
  [NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER]:
    "now on call",
  [NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER]:
    "next on call",
  [NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY]:
    "added",
};

// A rule of Checkout that pages the schedule too.
const CHECKOUT_ESCALATE_ID: ObjectID = new ObjectID(
  "10586000-0000-4000-8000-0000000000e4",
);

const POLICY_LINK: string = "https://oneuptime.test/policies/1";

const YESTERDAY: Date = new Date("2026-11-19T09:00:00.000Z");
const TODAY: Date = new Date("2026-11-20T09:00:00.000Z");
const TOMORROW: Date = new Date("2026-11-21T09:00:00.000Z");
const DAY_AFTER: Date = new Date("2026-11-22T09:00:00.000Z");

const SLACK_TOMORROW: string =
  "{{DATE(2026-11-21T09:00:00Z, SHORT)}} at {{TIME(2026-11-21T09:00:00Z)}}";

let world: ReachWorld;
let told: Array<string>;
let reasons: Array<string>;
let rows: Array<OnCallDutyPolicyFeed>;
// "[NobodyOnCall] ⚠️ Nobody is paged ...": each Slack line, with what it is.
let lines: Array<string>;

beforeEach(() => {
  world = new ReachWorld();
  world.install();
  world.describeRule(CHECKOUT_ESCALATE_ID, {
    policyId: OTHER_POLICY_ID,
    name: "Escalate",
    order: 2,
  });
  world.inviteeNames.set(IVY.toString().toLowerCase(), "Ivy");
  world.userNames.set(CY.toString().toLowerCase(), "Cy");
  world.rosterHandoffAt = TOMORROW;
  world.rosterNextStartAt = TOMORROW;

  told = [];
  reasons = [];
  rows = [];
  lines = [];

  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString(POLICY_LINK));
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
      reasons.push(String(data.emailEnvelope.vars["reason"] || ""));
    }) as never);

  // The policy's feed, and one Slack workspace connected.
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneBy")
    .mockResolvedValue(null);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation((async (data: { userId: ObjectID }) => {
      return mdText`[${NAMES[data.userId.toString()] || "?"}](https://oneuptime.test/users/${data.userId.toString()})`;
    }) as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockImplementation((async () => {
      const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      auth.workspaceType = WorkspaceType.Slack;
      auth.authToken = "token";
      return [auth];
    }) as never);
  jest
    .spyOn(WorkspaceUtil, "getUserStringForWorkspace")
    .mockImplementation((async (data: { userId: ObjectID }) => {
      return `@${(NAMES[data.userId.toString()] || "?").toLowerCase()} `;
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyFeedService, "create")
    .mockImplementation((async (data: { data: OnCallDutyPolicyFeed }) => {
      rows.push(data.data);
      return data.data;
    }) as never);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "sendWorkspaceMarkdownNotification",
    )
    .mockImplementation((async (data: {
      markdownByWorkspaceType?: Partial<Record<WorkspaceType, string>>;
      workspaceNotification: {
        updateKinds?: Array<NotificationRuleUpdateKind> | undefined;
      };
    }) => {
      lines.push(
        `[${(data.workspaceNotification.updateKinds || []).join(",")}] ${data.markdownByWorkspaceType?.[WorkspaceType.Slack] || ""}`,
      );
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The schedule's shift moves from `from` to `to` - who was next - and
 * `next` is next now: the roster a page works out says `to` from here on.
 */
async function handoff(data: {
  from: ObjectID | null;
  to: ObjectID | null;
  next?: ObjectID | null;
}): Promise<void> {
  world.onCall.set(PRIMARY.toString(), data.to);
  world.next.set(PRIMARY.toString(), data.next || null);

  await (
    OnCallDutyPolicyScheduleService as unknown as {
      sendNotificationToUserOnScheduleHandoff: (data: {
        scheduleId: ObjectID;
        previousInformation: Record<string, unknown>;
        newInformation: Record<string, unknown>;
      }) => Promise<void>;
    }
  ).sendNotificationToUserOnScheduleHandoff({
    scheduleId: PRIMARY,
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

// Ivy, invited to Platform and not joined yet.
function invited(): void {
  world.addMember(IVY, PLATFORM, false);
}

describe("an invitee reached in the rotation", () => {
  test("REGRESSION: their turn is a gap - the feed and the channels that want one hear nobody is paged, and why", async () => {
    invited();
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);

    await handoff({ from: BO, to: IVY, next: BO });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
      OnCallDutyPolicyFeedEventType.CoverageGapStarted,
    );
    expect(rows[0]!.feedInfoInMarkdown).toContain(
      `, when **[Bo](https://oneuptime.test/users/${BO.toString()})** takes over: **[ivy@acme.test](https://oneuptime.test/users/${IVY.toString()})** is on call but hasn't joined the project yet.`,
    );

    // It was "📞 @ivy@acme.test is now on call for Payments ..., then @bo."
    expect(lines).toEqual([
      `[NobodyOnCall] ⚠️ Nobody is paged for [Payments](${POLICY_LINK}) until ${SLACK_TOMORROW}, when @bo takes over: **Ivy** is on call but hasn't joined the project yet.`,
    ]);

    // Ivy is told nothing and logged nowhere, as #10567 made it.
    expect(told).toEqual([
      "Bo: no longer on call for Payments",
      "Bo: next on call for Payments",
    ]);
    expect(world.logsOf(IVY)).toEqual([]);
  });

  test("her turn ending: whoever takes over is on call, as ever", async () => {
    invited();
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), IVY);

    await handoff({ from: IVY, to: BO });

    expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
      OnCallDutyPolicyFeedEventType.RosterHandoff,
    );
    expect(lines).toEqual([
      `[OnCallNow] 📞 @bo is now on call for [Payments](${POLICY_LINK}) until ${SLACK_TOMORROW}.`,
    ]);
  });

  test("REGRESSION: next in the rotation: then nobody, and the channels that want who is next hear nobody will be paged", async () => {
    invited();
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ from: ANA, to: BO, next: IVY });

    // It was "..., then @ivy@acme.test." and "➡️ @ivy@acme.test is next on call ...".
    expect(lines).toEqual([
      `[OnCallNow] 📞 @bo is now on call for [Payments](${POLICY_LINK}) until ${SLACK_TOMORROW}, then nobody: **Ivy** is next but hasn't joined the project yet.`,
      `[OnCallNow] 📞 @bo is now on call for [Payments](${POLICY_LINK}) until ${SLACK_TOMORROW}.`,
      `[OnCallNext] ⚠️ Nobody will be paged for [Payments](${POLICY_LINK}) from ${SLACK_TOMORROW}: **Ivy** is next but hasn't joined the project yet.`,
    ]);
    expect(told).toEqual([
      "Ana: no longer on call for Payments",
      "Bo: now on call for Payments",
    ]);
  });

  test("two policies page the schedule: each one's feed and channels hear the gap once", async () => {
    invited();
    members(BO);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(PRIMARY, { ruleId: CHECKOUT_ESCALATE_ID });
    world.onCall.set(PRIMARY.toString(), BO);

    await handoff({ from: BO, to: IVY });

    expect(
      rows.map((row: OnCallDutyPolicyFeed): string => {
        return `${world.nameOf(row.onCallDutyPolicyId!)}: ${row.onCallDutyPolicyFeedEventType}`;
      }),
    ).toEqual(["Payments: CoverageGapStarted", "Checkout: CoverageGapStarted"]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(
      "**Ivy** is on call but hasn't joined the project yet.",
    );
  });

  test("someone who has left, still on the roster: nobody is paged - they aren't a member - named by their own name", async () => {
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);

    await handoff({ from: BO, to: CY });

    expect(lines).toEqual([
      `[NobodyOnCall] ⚠️ Nobody is paged for [Payments](${POLICY_LINK}) until ${SLACK_TOMORROW}: **Cy** is on call but isn't a member of the project.`,
    ]);
  });

  test("who is a member could not be read: everybody is posted as before", async () => {
    invited();
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);
    jest
      .mocked(ProjectMembership.getMemberUserIds)
      .mockRejectedValue(new Error("unreachable") as never);

    await handoff({ from: BO, to: IVY });

    expect(lines[0]).toContain("is now on call for [Payments]");
  });
});

describe("joining mid-shift", () => {
  afterEach(() => {
    // As the project knew her while she was only invited.
    NAMES[IVY.toString()] = "ivy@acme.test";
  });

  test("REGRESSION: the gap posted, then her joining - a page reaches her now - her shift logged from then, and its end said as anyone's", async () => {
    invited();
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);

    // 1. Ivy's turn comes while she is only invited: a gap.
    await handoff({ from: BO, to: IVY, next: BO });

    expect(lines).toEqual([
      expect.stringContaining(
        "[NobodyOnCall] ⚠️ Nobody is paged for [Payments]",
      ),
    ]);

    // 2. She accepts her invitation during it.
    lines = [];
    rows = [];
    told = [];
    reasons = [];
    world.accept(IVY);
    NAMES[IVY.toString()] = "Ivy";

    await EscalationRuleReach.openTimeLogsOfMember({
      projectId: PROJECT_ID,
      userId: IVY,
    });
    await OnCallJoinNotices.tellJoined({
      projectId: PROJECT_ID,
      userId: IVY,
      join: { membershipId: null },
    });

    // The channels that heard nobody was paged hear she is on call now.
    expect(lines).toEqual([
      `[OnCallNow] 📞 @ivy has joined the project and is now on call for [Payments](${POLICY_LINK}) until ${SLACK_TOMORROW}, then @bo.`,
      `[OnCallNow] 📞 @ivy has joined the project and is now on call for [Payments](${POLICY_LINK}) until ${SLACK_TOMORROW}.`,
    ]);
    expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
      OnCallDutyPolicyFeedEventType.RosterHandoff,
    );
    expect(rows[0]!.userId?.toString()).toBe(IVY.toString());
    // She is told, and logged on her shift from now (#10567).
    expect(told).toEqual(["Ivy: added for Payments"]);
    expect(reasons[0]).toContain(
      "You are on call now on the roster of schedule Primary.",
    );
    expect(world.logsOf(IVY)).toEqual([`start schedule ${PRIMARY.toString()}`]);

    // 3. Her shift ends: she is told, as any member, and the log ends.
    lines = [];
    told = [];

    await handoff({ from: IVY, to: BO });

    expect(told).toEqual([
      "Ivy: no longer on call for Payments",
      "Bo: now on call for Payments",
    ]);
    expect(world.logsOf(IVY)).toEqual([
      `start schedule ${PRIMARY.toString()}`,
      `end schedule ${PRIMARY.toString()}`,
    ]);
    expect(lines[0]).toBe(
      `[OnCallNow] 📞 @bo is now on call for [Payments](${POLICY_LINK}) until ${SLACK_TOMORROW}.`,
    );
  });

  test("next when she joins: the channels that want who is next hear she is", async () => {
    invited();
    members(ANA, BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), ANA);

    await handoff({ from: ANA, to: BO, next: IVY });

    lines = [];
    world.accept(IVY);
    NAMES[IVY.toString()] = "Ivy";

    await OnCallJoinNotices.tellJoined({
      projectId: PROJECT_ID,
      userId: IVY,
      join: { membershipId: null },
    });

    expect(lines).toEqual([
      `[OnCallNext] ➡️ @ivy has joined the project and is next on call for [Payments](${POLICY_LINK}), from ${SLACK_TOMORROW}.`,
    ]);
  });

  test("a member who joins another team posts nothing: no gap was ever posted for them", async () => {
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);
    const platform: ReturnType<ReachWorld["addMember"]> = world.addMember(
      BO,
      PLATFORM,
      true,
    );

    await OnCallJoinNotices.tellJoined({
      projectId: PROJECT_ID,
      userId: BO,
      join: { membershipId: platform.id },
    });

    expect(lines).toEqual([]);
    expect(rows).toEqual([]);
  });

  test("still only invited - an acceptance that did not take: nothing is posted", async () => {
    invited();
    members(BO);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), IVY);

    await OnCallJoinNotices.tellJoined({
      projectId: PROJECT_ID,
      userId: IVY,
      join: { membershipId: null },
    });

    expect(lines).toEqual([]);
    expect(rows).toEqual([]);
  });
});
