import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import OnCallHandoffPosts, {
  OnCallHandoff,
} from "../../../Server/Utils/OnCall/OnCallHandoffPosts";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import URL from "../../../Types/API/URL";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A HANDOFF IS POSTED ONCE FOR EACH POLICY, NOT ONCE FOR EACH ESCALATION
 * RULE (issue #7549).
 *
 * A schedule paged by two escalation rules of one policy posted every
 * handoff twice over to the policy's feed and channels - each copy naming
 * its rule and its order. Now each policy that pages the schedule posts
 * the handoff once (OnCallHandoffPosts), after every person on call has
 * been told; each rule still tells its people and keeps its time logs. A
 * rule that pages only the next person in the rotation posts nothing, as
 * before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "75490000-0000-4000-8000-000000000101",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "75490000-0000-4000-8000-000000000102",
);
const PAYMENTS: ObjectID = new ObjectID("75490000-0000-4000-8000-000000000103");
const CHECKOUT: ObjectID = new ObjectID("75490000-0000-4000-8000-000000000104");
const NEXT_ONLY: ObjectID = new ObjectID(
  "75490000-0000-4000-8000-000000000105",
);
const ANA: ObjectID = new ObjectID("75490000-0000-4000-8000-0000000001a1");
const BOB: ObjectID = new ObjectID("75490000-0000-4000-8000-0000000001b1");
const CARL: ObjectID = new ObjectID("75490000-0000-4000-8000-0000000001c1");

const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana",
  [BOB.toString()]: "Bob",
  [CARL.toString()]: "Carl",
};

const YESTERDAY: Date = new Date("2026-11-13T22:50:00.000Z");
const TODAY: Date = new Date("2026-11-14T22:50:00.000Z");
const TOMORROW: Date = new Date("2026-11-15T22:50:00.000Z");
const DAY_AFTER: Date = new Date("2026-11-16T22:50:00.000Z");

interface Roster {
  currentUserIdOnRoster: ObjectID | null;
  rosterHandoffAt: Date | null;
  nextUserIdOnRoster: ObjectID | null;
  nextHandOffTimeAt: Date | null;
  rosterStartAt: Date | null;
  nextRosterStartAt: Date | null;
}

// Carl was on call until today, Ana next.
const BEFORE: Roster = {
  currentUserIdOnRoster: CARL,
  rosterHandoffAt: TODAY,
  nextUserIdOnRoster: ANA,
  nextHandOffTimeAt: TOMORROW,
  rosterStartAt: YESTERDAY,
  nextRosterStartAt: TODAY,
};

// Ana is on call until tomorrow, then Bob.
const AFTER: Roster = {
  currentUserIdOnRoster: ANA,
  rosterHandoffAt: TOMORROW,
  nextUserIdOnRoster: BOB,
  nextHandOffTimeAt: DAY_AFTER,
  rosterStartAt: TODAY,
  nextRosterStartAt: TOMORROW,
};

function attachment(data: {
  policyId: ObjectID;
  policyName: string;
  ruleName: string;
  order: number;
  pageNextInRotation?: boolean;
}): OnCallDutyPolicyEscalationRuleSchedule {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = data.policyId;
  policy.name = data.policyName;

  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.id = ObjectID.generate();
  rule.name = data.ruleName;
  rule.order = data.order;

  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = SCHEDULE_ID;
  schedule.name = "Primary";
  schedule.timezone = Timezone.AmericaNew_York;

  const row: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  row.id = ObjectID.generate();
  row.projectId = PROJECT_ID;
  row.pageNextInRotation = Boolean(data.pageNextInRotation);
  row.onCallDutyPolicy = policy;
  row.onCallDutyPolicyEscalationRule = rule;
  row.onCallDutyPolicySchedule = schedule;
  return row;
}

// Payments pages the schedule from two rules; Checkout from one.
const ATTACHMENTS: Array<OnCallDutyPolicyEscalationRuleSchedule> = [
  attachment({
    policyId: PAYMENTS,
    policyName: "Payments",
    ruleName: "First line",
    order: 1,
  }),
  attachment({
    policyId: PAYMENTS,
    policyName: "Payments",
    ruleName: "Escalate",
    order: 2,
  }),
  attachment({
    policyId: CHECKOUT,
    policyName: "Checkout",
    ruleName: "First line",
    order: 1,
  }),
  // Pages the next person in the rotation, never whoever is on call.
  attachment({
    policyId: NEXT_ONLY,
    policyName: "Warm standby",
    ruleName: "Next in rotation",
    order: 1,
    pageNextInRotation: true,
  }),
];

let told: Array<{ userId: string; eventType: NotificationSettingEventType }>;
let steps: Array<string>;

async function handoff(data: {
  before: Roster;
  after: Roster;
  attachments?: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}): Promise<void> {
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue(data.attachments || ATTACHMENTS);

  await (
    OnCallDutyPolicyScheduleService as unknown as {
      sendNotificationToUserOnScheduleHandoff: (data: {
        scheduleId: ObjectID;
        previousInformation: Roster;
        newInformation: Roster;
      }) => Promise<void>;
    }
  ).sendNotificationToUserOnScheduleHandoff({
    scheduleId: SCHEDULE_ID,
    previousInformation: data.before,
    newInformation: data.after,
  });
}

beforeEach(() => {
  told = [];
  steps = [];

  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockImplementation((async (_projectId: ObjectID, policyId: ObjectID) => {
      return URL.fromString(
        `https://oneuptime.test/dashboard/on-call-duty/policies/${policyId.toString()}`,
      );
    }) as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
    }) => {
      steps.push("tell " + NAMES[data.userId.toString()]);
      told.push({
        userId: data.userId.toString(),
        eventType: data.eventType,
      });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which policies post a handoff, and when", () => {
  let posted: Array<OnCallHandoff>;

  beforeEach(() => {
    posted = [];

    jest.spyOn(OnCallHandoffPosts, "post").mockImplementation((async (
      change: OnCallHandoff,
    ) => {
      steps.push("post " + change.onCallDutyPolicyName);
      posted.push(change);
    }) as never);
  });

  test("REGRESSION: a policy that pages the schedule from two rules posts the handoff once", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    expect(
      posted.map((change: OnCallHandoff): string => {
        return change.onCallDutyPolicyName;
      }),
    ).toEqual(["Payments", "Checkout"]);
  });

  test("the handoff carries who was and is on call, who is next and from when, and the schedule's zone", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    expect(posted[0]).toEqual({
      projectId: PROJECT_ID,
      onCallDutyPolicyId: PAYMENTS,
      onCallDutyPolicyName: "Payments",
      scheduleId: SCHEDULE_ID,
      scheduleName: "Primary",
      scheduleTimezone: Timezone.AmericaNew_York,
      previousUserId: CARL,
      previousNextUserId: ANA,
      currentUserId: ANA,
      handoffAt: TOMORROW,
      nextUserId: BOB,
      nextStartsAt: TOMORROW,
    });
  });

  test("each rule still tells its people, and the posts come after every one of them is told", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    // Carl, Ana and Bob, for each of the three rules that page whoever is on call.
    expect(told).toHaveLength(9);
    expect(
      told.filter((entry: { eventType: NotificationSettingEventType }) => {
        return (
          entry.eventType ===
          NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER
        );
      }),
    ).toHaveLength(3);

    expect(steps.slice(-2)).toEqual(["post Payments", "post Checkout"]);
  });

  test("a rule that pages only the next person in the rotation posts nothing, and tells nobody", async () => {
    await handoff({
      before: BEFORE,
      after: AFTER,
      attachments: [ATTACHMENTS[3]!],
    });

    expect(posted).toEqual([]);
    expect(told).toEqual([]);
  });

  test("the schedule service writes no feed entry of its own any more", async () => {
    const create: SpyInstance<
      typeof OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem
    > = jest.spyOn(
      OnCallDutyPolicyFeedService,
      "createOnCallDutyPolicyFeedItem",
    );

    await handoff({ before: BEFORE, after: AFTER });
    await handoff({
      before: BEFORE,
      after: { ...AFTER, currentUserIdOnRoster: null, rosterHandoffAt: null },
    });

    expect(create).not.toHaveBeenCalled();
  });
});

describe("what a policy's feed and channels get from a handoff", () => {
  let rows: Array<OnCallDutyPolicyFeed>;
  let lines: Array<string>;

  beforeEach(() => {
    rows = [];
    lines = [];

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
      }) => {
        lines.push(data.markdownByWorkspaceType?.[WorkspaceType.Slack] || "");
      }) as never);
  });

  test("REGRESSION: one feed entry for each policy - never one for each rule, nor one for each of the three people", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    expect(rows).toHaveLength(2);
    expect(rows[0]!.onCallDutyPolicyId?.toString()).toBe(PAYMENTS.toString());
    expect(rows[1]!.onCallDutyPolicyId?.toString()).toBe(CHECKOUT.toString());

    for (const row of rows) {
      expect(row.onCallDutyPolicyFeedEventType).toBe(
        OnCallDutyPolicyFeedEventType.RosterHandoff,
      );
      expect(row.feedInfoInMarkdown).toMatch(/^📞 \*\*\[Ana\]/);
      expect(row.feedInfoInMarkdown).not.toMatch(
        /escalation rule|with order|no longer on call|GMT/i,
      );
    }
  });

  test("each policy's lines name the policy - one for each way its channels can want them", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    expect(lines).toHaveLength(6);
    expect(
      lines.filter((line: string): boolean => {
        return line.includes(PAYMENTS.toString());
      }),
    ).toHaveLength(3);
    expect(lines[0]).toMatch(
      /^📞 @ana is now on call for \[Payments\]\(.+\) until .+, then @bob\.$/,
    );
  });

  test("a gap: one Nobody on call entry for each policy, until the next person's turn", async () => {
    await handoff({
      before: BEFORE,
      after: {
        currentUserIdOnRoster: null,
        rosterHandoffAt: null,
        nextUserIdOnRoster: BOB,
        nextHandOffTimeAt: DAY_AFTER,
        rosterStartAt: null,
        nextRosterStartAt: TOMORROW,
      },
    });

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.onCallDutyPolicyFeedEventType).toBe(
        OnCallDutyPolicyFeedEventType.CoverageGapStarted,
      );
      expect(row.feedInfoInMarkdown).toMatch(
        /^⚠️ Nobody is on call for \[(Payments|Checkout)\]\(.+\) until Nov 15 2026, .+ EST, when \*\*\[Bob\]/,
      );
    }

    expect(lines).toHaveLength(2);
  });

  test("a feed entry that cannot be written fails nothing else: everyone is told, every channel hears the handoff", async () => {
    let failed: boolean = false;

    jest
      .spyOn(OnCallDutyPolicyFeedService, "create")
      .mockImplementation((async (data: { data: OnCallDutyPolicyFeed }) => {
        if (!failed) {
          failed = true;
          throw new Error("the database is busy");
        }

        rows.push(data.data);
        return data.data;
      }) as never);

    await expect(
      handoff({ before: BEFORE, after: AFTER }),
    ).resolves.toBeUndefined();

    expect(told).toHaveLength(9);
    // Payments' entry failed; Checkout's was written.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.onCallDutyPolicyId?.toString()).toBe(CHECKOUT.toString());
    // Both policies' channels heard it all the same.
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain("[Payments]");
  });

  test("a rotation of one - the handoff time moves on, the same person stays on call - is not posted", async () => {
    await handoff({
      before: {
        ...BEFORE,
        currentUserIdOnRoster: ANA,
        nextUserIdOnRoster: ANA,
      },
      after: { ...AFTER, nextUserIdOnRoster: ANA },
    });

    expect(rows).toEqual([]);
    expect(lines).toEqual([]);
    expect(told).toEqual([]);
  });
});
