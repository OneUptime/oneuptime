import { describe, expect, test } from "@jest/globals";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../../../Models/DatabaseModels/Team";
import User from "../../../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import { NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE } from "../../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OnCallPolicyRunMessageView, {
  OnCallDirectPageRun,
  OnCallPolicyRun,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import Email from "../../../../../Types/Email";
import ObjectID from "../../../../../Types/ObjectID";
import { getAwayTimelineMessage } from "../../../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import OnCallDutyExecutionLogTimelineStatus from "../../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
} from "../../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import OnCallDutyPolicyStatus from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationStatus from "../../../../../Types/UserNotification/UserNotificationStatus";

/*
 * HOW A DIRECT PAGE'S STEPS BECOME ITS ONE MESSAGE.
 *
 * buildRun folds a run - its execution log, its timeline and how each page
 * was delivered - into what its Slack / Microsoft Teams message says. A
 * direct page's run has no policy and no escalation rules, and its timeline
 * lines name no rule: each person is listed once, each target that reached
 * nobody says why - a schedule with nobody on call, a team with no members,
 * a person who is away or has left - and no rule is ever said to have
 * reached nobody.
 */

const NITIN: ObjectID = ObjectID.generate();
const JANE: ObjectID = ObjectID.generate();
const ALEX: ObjectID = ObjectID.generate();
const NB_USER_2: ObjectID = ObjectID.generate();
const SECONDARY: ObjectID = ObjectID.generate();
const PRIMARY: ObjectID = ObjectID.generate();
const PLATFORM: ObjectID = ObjectID.generate();
const DATABASE: ObjectID = ObjectID.generate();

const BY_WORKFLOW: OnCallDirectPageRun = {
  startedByWorkflowName: "Page the on-call engineer",
  startedByWorkflowUrl:
    "https://oneuptime.test/dashboard/p/workflows/w/builder",
};

const SENT: OnCallDutyExecutionLogTimelineStatus =
  OnCallDutyExecutionLogTimelineStatus.NotificationSent;
const SKIPPED: OnCallDutyExecutionLogTimelineStatus =
  OnCallDutyExecutionLogTimelineStatus.Skipped;

function user(name: string | undefined, email?: string): User {
  const model: User = new User();

  if (name !== undefined) {
    model.name = name as never;
  }

  if (email) {
    model.email = new Email(email);
  }

  return model;
}

interface LineOptions {
  status: OnCallDutyExecutionLogTimelineStatus;
  userId?: ObjectID;
  userName?: string;
  userEmail?: string;
  scheduleId?: ObjectID;
  scheduleName?: string;
  teamId?: ObjectID;
  teamName?: string;
  statusMessage?: string;
  isAcknowledged?: boolean;
  coveringForId?: ObjectID;
  coveringForName?: string;
}

// A line of a direct page's timeline: no policy, no escalation rule.
function line(options: LineOptions): OnCallDutyPolicyExecutionLogTimeline {
  const model: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  model.id = ObjectID.generate();
  model.status = options.status;

  if (options.userId) {
    model.alertSentToUserId = options.userId;
    model.alertSentToUser = user(options.userName, options.userEmail);
  }

  if (options.scheduleId) {
    model.onCallDutyScheduleId = options.scheduleId;
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();

    if (options.scheduleName !== undefined) {
      schedule.name = options.scheduleName;
    }

    model.onCallDutySchedule = schedule;
  }

  if (options.teamId) {
    model.userBelongsToTeamId = options.teamId;
    const team: Team = new Team();

    if (options.teamName !== undefined) {
      team.name = options.teamName;
    }

    model.userBelongsToTeam = team;
  }

  if (options.statusMessage !== undefined) {
    model.statusMessage = options.statusMessage;
  }

  if (options.isAcknowledged) {
    model.isAcknowledged = true;
  }

  if (options.coveringForId) {
    model.overridedByUserId = options.coveringForId;
    model.overridedByUser = user(options.coveringForName);
  }

  return model;
}

function delivery(
  userId: ObjectID,
  status: UserNotificationStatus,
  method: keyof UserOnCallLogTimeline,
): UserOnCallLogTimeline {
  const model: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  model.userId = userId;
  model.status = status;
  (model as unknown as Record<string, unknown>)[method] = ObjectID.generate();
  return model;
}

// A direct page's run as it is read: no policy, paging started at once.
function pageLog(options?: {
  status?: OnCallDutyPolicyStatus | undefined;
  pagingStartedAt?: Date | undefined;
  acknowledgedBy?: User | undefined;
}): OnCallDutyPolicyExecutionLog {
  const model: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();
  model.id = ObjectID.generate();
  model.status = options?.status ?? OnCallDutyPolicyStatus.Executing;
  model.onCallPolicyExecutionRepeatCount = 1;
  model.executeNextEscalationRuleInMinutes = 0;
  model.lastEscalationRuleExecutedAt =
    options?.pagingStartedAt ?? new Date("2026-10-08T17:15:00.000Z");

  if (options?.acknowledgedBy) {
    model.acknowledgedByUserId = ObjectID.generate();
    model.acknowledgedByUser = options.acknowledgedBy;
  }

  return model;
}

function build(data: {
  log?: OnCallDutyPolicyExecutionLog;
  timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
  deliveries?: Array<UserOnCallLogTimeline>;
  directPage?: OnCallDirectPageRun | undefined;
  rules?: Array<OnCallDutyPolicyEscalationRule>;
}): OnCallPolicyRun {
  return OnCallPolicyRunMessage.buildRun({
    executionLog: data.log || pageLog(),
    rules: data.rules || [],
    timeline: data.timeline,
    deliveries: data.deliveries || [],
    policyUrl: "",
    runUrl: "https://oneuptime.test/run",
    recordLabel: "Incident INC-8",
    recordUrl: "https://oneuptime.test/incident",
    ...("directPage" in data
      ? { directPage: data.directPage }
      : { directPage: BY_WORKFLOW }),
  });
}

describe("a direct page's run, as its message tells it", () => {
  const built: OnCallPolicyRun = build({
    timeline: [
      line({
        status: SENT,
        userId: NITIN,
        userName: "Nitin",
        statusMessage: "Alert Sent",
      }),
    ],
  });

  test("it carries who started the page, and names no policy", () => {
    expect(built.directPage).toEqual(BY_WORKFLOW);
    expect(built.policyName).toBe("");
    expect(built.policyUrl).toBe("");
  });

  test("it has no escalation rule: none it is on, none next, none that reached nobody", () => {
    expect(built.ruleCount).toBe(0);
    expect(built.currentRule).toBeUndefined();
    expect(built.nextRule).toBeUndefined();
    expect(built.firstRuleThatReachedNobody).toBeUndefined();
    expect(built).not.toHaveProperty("retryingCurrentRule");
  });

  test("it has no next step and no repeats: everybody is paged at once", () => {
    expect(built.escalateAfterInMinutes).toBe(0);
    expect(built.nextStepAt).toBeUndefined();
    expect(built.repeatNumber).toBe(0);
    expect(built.repeatsAllowed).toBe(0);
  });

  test("it is paging until its ending is read", () => {
    expect(built.outcome).toBe(OnCallPolicyRunOutcome.Paging);
  });

  test("its message is the headline, the people and the link - no rule paragraph", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(built)).toBe(
      [
        "📟 Workflow **[Page the on-call engineer](https://oneuptime.test/dashboard/p/workflows/w/builder)** is paging for **[Incident INC-8](https://oneuptime.test/incident)**",
        "- **Nitin**: paged once",
        "[See every step in OneUptime](https://oneuptime.test/run)",
      ].join("\n\n"),
    );
  });
});

describe("the people a direct page paged", () => {
  test("each once, in the order paged, with how each page reached them", () => {
    const built: OnCallPolicyRun = build({
      timeline: [
        line({ status: SENT, userId: NITIN, userName: "Nitin" }),
        line({
          status: SENT,
          userId: JANE,
          userName: "Jane Doe",
          teamId: PLATFORM,
          teamName: "Platform",
        }),
        line({
          status: OnCallDutyExecutionLogTimelineStatus.Executing,
          userId: ALEX,
          userName: "Alex Kim",
          scheduleId: PRIMARY,
          scheduleName: "Primary",
        }),
      ],
      deliveries: [
        delivery(NITIN, UserNotificationStatus.Sent, "userEmailId"),
        delivery(NITIN, UserNotificationStatus.Sent, "userSmsId"),
        delivery(JANE, UserNotificationStatus.Acknowledged, "userCallId"),
        // Not out yet: says nothing about how Alex was reached.
        delivery(ALEX, UserNotificationStatus.Sending, "userPushId"),
      ],
    });

    expect(built.paged).toEqual([
      {
        name: "Nitin",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["SMS", "email"],
        coveringFor: [],
      },
      {
        name: "Jane Doe",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["call"],
        coveringFor: [],
        // Paged as a member of the team the page named.
        teams: ["Platform"],
      },
      {
        name: "Alex Kim",
        timesPaged: 0,
        isBeingPaged: true,
        acknowledged: false,
        methods: [],
        coveringFor: [],
      },
    ]);
    expect(built.notPaged).toEqual([]);
  });

  test("somebody named themselves and again through a team is listed once", () => {
    const built: OnCallPolicyRun = build({
      timeline: [
        line({
          status: SENT,
          userId: NITIN,
          userName: "Nitin",
          teamId: PLATFORM,
          teamName: "Platform",
        }),
        line({
          status: SKIPPED,
          userId: NITIN,
          userName: "Nitin",
          statusMessage:
            "Skipped because notification sent to this user already.",
        }),
      ],
    });

    expect(built.paged).toHaveLength(1);
    expect(built.paged[0]!.name).toBe("Nitin");
    expect(built.paged[0]!.timesPaged).toBe(1);
    // Reached through the team: the line names it, once.
    expect(built.paged[0]!.teams).toEqual(["Platform"]);
    expect(built.notPaged).toEqual([]);
  });

  test("somebody paged in place of a person who is away says who they cover for", () => {
    const built: OnCallPolicyRun = build({
      timeline: [
        line({
          status: SENT,
          userId: JANE,
          userName: "Jane Doe",
          coveringForId: ALEX,
          coveringForName: "Alex Kim",
        }),
      ],
    });

    expect(built.paged[0]!.coveringFor).toEqual(["Alex Kim"]);
  });

  test("the person who acknowledged is marked, and named as who acknowledged", () => {
    const built: OnCallPolicyRun = build({
      log: pageLog({
        status: OnCallDutyPolicyStatus.Completed,
        acknowledgedBy: user("Nitin"),
      }),
      timeline: [
        line({
          status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
          userId: NITIN,
          userName: "Nitin",
          isAcknowledged: true,
        }),
        line({ status: SENT, userId: JANE, userName: "Jane Doe" }),
      ],
    });

    expect(built.acknowledgedByName).toBe("Nitin");
    expect(built.paged[0]).toEqual(
      expect.objectContaining({ name: "Nitin", acknowledged: true }),
    );
    expect(built.paged[1]).toEqual(
      expect.objectContaining({ name: "Jane Doe", acknowledged: false }),
    );
  });

  test("a person with no name is listed by their email address", () => {
    const built: OnCallPolicyRun = build({
      timeline: [
        line({
          status: SENT,
          userId: NITIN,
          userEmail: "nitin@example.com",
        }),
      ],
    });

    expect(built.paged[0]!.name).toBe("nitin@example.com");
  });
});

describe("the targets a direct page reached nobody through", () => {
  test("a schedule with nobody on call, by the schedule's name", () => {
    const built: OnCallPolicyRun = build({
      timeline: [
        line({
          status: SKIPPED,
          scheduleId: SECONDARY,
          scheduleName: "Secondary",
          statusMessage: "Skipped because no one is on call.",
        }),
      ],
    });

    expect(built.notPaged).toEqual([
      { scheduleName: "Secondary", reason: "nobody was on call" },
    ]);
  });

  test("a team with no members, by the team's name", () => {
    const built: OnCallPolicyRun = build({
      timeline: [
        line({
          status: SKIPPED,
          teamId: PLATFORM,
          teamName: "Platform",
          statusMessage: ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
        }),
      ],
    });

    expect(built.notPaged).toEqual([
      { teamName: "Platform", reason: "has no members" },
    ]);
  });

  test("each team once, and a team with no name is said to have none", () => {
    const built: OnCallPolicyRun = build({
      timeline: [
        line({ status: SKIPPED, teamId: PLATFORM, teamName: "Platform" }),
        line({ status: SKIPPED, teamId: PLATFORM, teamName: "Platform" }),
        line({ status: SKIPPED, teamId: DATABASE, teamName: "  " }),
      ],
    });

    expect(built.notPaged).toEqual([
      { teamName: "Platform", reason: "has no members" },
      { teamName: "(unnamed)", reason: "has no members" },
    ]);
  });

  test("a person who is away with nobody to cover, and until when", () => {
    const until: Date = new Date("2026-10-17T09:00:00.000Z");
    const built: OnCallPolicyRun = build({
      timeline: [
        line({
          status: SKIPPED,
          userId: ALEX,
          userName: "Alex Kim",
          statusMessage: getAwayTimelineMessage(until),
        }),
      ],
    });

    expect(built.paged).toEqual([]);
    expect(built.notPaged).toEqual([
      { personName: "Alex Kim", reason: "away", awayUntil: until },
    ]);
  });

  test("a person who is no longer a member of the project", () => {
    const built: OnCallPolicyRun = build({
      timeline: [
        line({
          status: SKIPPED,
          userId: NB_USER_2,
          userName: "NB User 2",
          statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
        }),
      ],
    });

    expect(built.notPaged).toEqual([
      { personName: "NB User 2", reason: "not a member of this project" },
    ]);
  });

  test("a person whose page failed, with why", () => {
    const built: OnCallPolicyRun = build({
      timeline: [
        line({
          status: OnCallDutyExecutionLogTimelineStatus.Error,
          userId: JANE,
          userName: "Jane Doe",
          statusMessage: "No notification rules for this severity.",
        }),
      ],
    });

    expect(built.paged).toEqual([]);
    expect(built.notPaged).toEqual([
      {
        personName: "Jane Doe",
        reason: "could not be paged (No notification rules for this severity)",
        failed: true,
      },
    ]);
  });

  test("the line of a page with nobody to page at all adds nothing: the run's ending says it", () => {
    const built: OnCallPolicyRun = build({
      log: pageLog({
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      }),
      timeline: [
        line({
          status: SKIPPED,
          statusMessage: ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
        }),
      ],
    });

    expect(built.paged).toEqual([]);
    expect(built.notPaged).toEqual([]);
    expect(built.firstRuleThatReachedNobody).toBeUndefined();
  });

  test("everything a page found, together and in the order it found it", () => {
    const built: OnCallPolicyRun = build({
      timeline: [
        line({
          status: SKIPPED,
          teamId: PLATFORM,
          teamName: "Platform",
          statusMessage: ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
        }),
        line({ status: SENT, userId: NITIN, userName: "Nitin" }),
        line({
          status: SKIPPED,
          userId: NB_USER_2,
          userName: "NB User 2",
          statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
        }),
        line({
          status: SKIPPED,
          scheduleId: SECONDARY,
          scheduleName: "Secondary",
        }),
      ],
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(built).split("\n\n")[1]).toBe(
      [
        "- **Nitin**: paged once",
        "- Team **Platform** has no members",
        "- **NB User 2**: not paged · not a member of this project",
        "- Nobody was on call in schedule **Secondary**",
      ].join("\n"),
    );
  });

  test("no escalation rule is ever said to have reached nobody, however the page ended", () => {
    for (const status of Object.values(OnCallDutyPolicyStatus)) {
      const built: OnCallPolicyRun = build({
        log: pageLog({ status: status }),
        timeline: [
          line({ status: SKIPPED, scheduleId: SECONDARY, scheduleName: "S" }),
          line({ status: SKIPPED, teamId: PLATFORM, teamName: "Platform" }),
          line({
            status: SKIPPED,
            userId: NB_USER_2,
            userName: "NB User 2",
            statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
          }),
          line({ status: SKIPPED }),
        ],
      });

      expect(built.firstRuleThatReachedNobody).toBeUndefined();

      for (const entry of built.notPaged) {
        expect(entry.rule).toBeUndefined();
      }
    }
  });
});

describe("who started the page, as given", () => {
  test.each<[string, OnCallDirectPageRun]>([
    ["a workflow with a link", BY_WORKFLOW],
    ["a workflow by name", { startedByWorkflowName: "Page SRE" }],
    ["a person", { startedByPersonName: "Sam Lee" }],
    ["nobody on record", {}],
  ])("%s is carried as it is", (_who: string, by: OnCallDirectPageRun) => {
    const built: OnCallPolicyRun = build({ timeline: [], directPage: by });

    expect(built.directPage).toEqual(by);
    expect(built.policyName).toBe("");
  });
});

describe("a policy's run is not read as a direct page", () => {
  function policyLog(): OnCallDutyPolicyExecutionLog {
    const log: OnCallDutyPolicyExecutionLog = pageLog();
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();

    policy.name = "PolicyX";
    policy.repeatPolicyIfNoOneAcknowledges = true;
    policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = 2;
    log.onCallDutyPolicy = policy;
    log.onCallDutyPolicyId = ObjectID.generate();

    return log;
  }

  test("it names its policy, and carries no direct page", () => {
    const built: OnCallPolicyRun = build({
      log: policyLog(),
      timeline: [],
      directPage: undefined,
    });

    expect(built.policyName).toBe("PolicyX");
    expect(built.directPage).toBeUndefined();
    expect("directPage" in built).toBe(false);
    expect(built.repeatsAllowed).toBe(2);
  });

  /*
   * An escalation rule's team with nobody in it says so, as a direct page's
   * does: a level whose only team is empty pages nobody, and its message
   * names the team rather than "nobody to page".
   */
  test("a skipped line of its timeline that names a team, with nobody on it, is a team with no members too", () => {
    const built: OnCallPolicyRun = build({
      log: policyLog(),
      timeline: [
        line({ status: SKIPPED, teamId: PLATFORM, teamName: "Platform" }),
      ],
      directPage: undefined,
    });

    expect(
      built.notPaged.filter((entry: { teamName?: string | undefined }) => {
        return entry.teamName !== undefined;
      }),
    ).toEqual([{ teamName: "Platform", reason: "has no members" }]);
  });

  test("a person skipped as a member of a team is the person, not an empty team", () => {
    const built: OnCallPolicyRun = build({
      log: policyLog(),
      timeline: [
        line({
          status: SKIPPED,
          userId: NITIN,
          userName: "Nitin",
          teamId: PLATFORM,
          teamName: "Platform",
          statusMessage:
            "Skipped because this user is not a member of the project.",
        }),
      ],
      directPage: undefined,
    });

    expect(
      built.notPaged.filter((entry: { teamName?: string | undefined }) => {
        return entry.teamName !== undefined;
      }),
    ).toEqual([]);
  });
});
