import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "../../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../../Server/Utils/Logger";
import OnCallChatText, {
  OnCallNotPagedBecause,
  OnCallNotPagedPerson,
} from "../../../../Server/Utils/OnCall/OnCallChatText";
import OnCallHandoffPosts, {
  OnCallChatLine,
  OnCallChatPost,
  OnCallHandoff,
  OnCallHandoffChange,
} from "../../../../Server/Utils/OnCall/OnCallHandoffPosts";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import URL from "../../../../Types/API/URL";
import { Green500, Red500, Yellow500 } from "../../../../Types/BrandColors";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";
import BaseNotificationRule from "../../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import WorkspaceMessagePayload from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A HAND-OFF SAYS WHO IS PAGED, NOT ONLY WHO IS ON THE ROSTER (#10586).
 *
 * Someone only invited to a project can be in a schedule's rotation
 * (#10412), and nothing pages them until they join: when their turn came,
 * the schedule paged nobody, while the policy's feed and its Slack,
 * Microsoft Teams and Mattermost channels said "📞 Ivy is now on call for
 * Payments until 5:50 PM, then Bob" - and "then Ivy", and "Ivy is next on
 * call", of a next person nothing would page. The people watching believed
 * somebody covered the shift.
 *
 * Now such a turn is the gap it is: the feed's Coverage gap started, to the
 * channels that want Nobody on call, saying until when and why - "⚠️
 * Nobody is paged for Payments until 5:50 PM, when @bob takes over: Ivy is
 * on call but hasn't joined the project yet" - and a next person nothing
 * pages is no one to take over: "..., then nobody: Ivy is next but hasn't
 * joined the project yet". In a channel, and in the policy's feed since
 * #10616, such a person is named by their display name alone - the name
 * typed with the invitation - never their email address. Joining during
 * the shift tells the channels a page reaches them from then on
 * (postJoinedDuringShift).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10586000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "10586000-0000-4000-8000-000000000002",
);
const OTHER_POLICY_ID: ObjectID = new ObjectID(
  "10586000-0000-4000-8000-000000000004",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "10586000-0000-4000-8000-000000000003",
);
const ANA: ObjectID = new ObjectID("10586000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("10586000-0000-4000-8000-0000000000b1");
const CARL: ObjectID = new ObjectID("10586000-0000-4000-8000-0000000000c1");
// Invited to the project at ivy@acme.test, and not joined yet.
const IVY: ObjectID = new ObjectID("10586000-0000-4000-8000-0000000000d1");

const IVY_ADDRESS: string = "ivy@acme.test";

const POLICY_LINK: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/policies/2";

// Friday 14 November 2026, 22:50 UTC: 5:50 PM in New York.
const HANDOFF_AT: Date = new Date("2026-11-14T22:50:00.000Z");

const SLACK_UNTIL: string =
  "{{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}";

/*
 * What the project calls each person: someone only invited with no name
 * typed is known by the address they were invited at (#10175) - which no
 * channel may say.
 */
const PROJECT_NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana",
  [BOB.toString()]: "Bob",
  [CARL.toString()]: "Carl",
  [IVY.toString()]: IVY_ADDRESS,
};

const { OnCallNow, OnCallNext, NobodyOnCall } = NotificationRuleUpdateKind;

// Ana takes over from Carl, until Friday; Bob is next. Everyone a member.
function handoff(overrides: Partial<OnCallHandoff> = {}): OnCallHandoff {
  return {
    projectId: PROJECT_ID,
    onCallDutyPolicyId: POLICY_ID,
    onCallDutyPolicyName: "Payments",
    scheduleId: SCHEDULE_ID,
    scheduleName: "Primary",
    scheduleTimezone: Timezone.AmericaNew_York,
    previousUserId: CARL,
    previousNextUserId: ANA,
    currentUserId: ANA,
    handoffAt: HANDOFF_AT,
    nextUserId: BOB,
    nextStartsAt: HANDOFF_AT,
    ...overrides,
  };
}

// Ivy's turn: Ana's shift ended, Ivy is on the roster, Bob next.
function ivyOnCall(overrides: Partial<OnCallHandoff> = {}): OnCallHandoff {
  return handoff({
    previousUserId: ANA,
    previousNextUserId: IVY,
    currentUserId: IVY,
    currentUserIsMember: false,
    ...overrides,
  });
}

// Ana's turn, with Ivy next.
function ivyNext(overrides: Partial<OnCallHandoff> = {}): OnCallHandoff {
  return handoff({
    previousNextUserId: ANA,
    nextUserId: IVY,
    nextUserIsMember: false,
    ...overrides,
  });
}

function at(date: Date): MarkdownText {
  return mdText`${date.toISOString().slice(11, 16)} UTC`;
}

const POLICY: MarkdownText = OnCallChatText.policy({
  name: "Payments",
  link: POLICY_LINK,
});

function person(
  name: string,
  because: OnCallNotPagedBecause = OnCallNotPagedBecause.NotJoinedYet,
): OnCallNotPagedPerson {
  return { name: name ? mdText`**${name}**` : mdText``, because: because };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the lines of a turn nothing pages", () => {
  test("REGRESSION: an invitee's turn is nobody paged - until when, who takes over, and why", () => {
    expect(
      OnCallChatText.nobodyPaged({
        policy: POLICY,
        schedule: "Primary",
        onCall: person("Ivy"),
        until: HANDOFF_AT,
        next: mdText`@bob`,
        moment: at,
      }).toString(),
    ).toBe(
      `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) through schedule Primary until 22:50 UTC, when @bob takes over: **Ivy** is on call but hasn't joined the project yet.`,
    );
  });

  test("with nobody paged to take over, with no end, and with neither", () => {
    expect(
      OnCallChatText.nobodyPaged({
        policy: POLICY,
        schedule: "Primary",
        onCall: person("Ivy"),
        until: HANDOFF_AT,
        moment: at,
      }).toString(),
    ).toBe(
      `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) through schedule Primary until 22:50 UTC: **Ivy** is on call but hasn't joined the project yet.`,
    );
    expect(
      OnCallChatText.nobodyPaged({
        policy: POLICY,
        schedule: "Primary",
        onCall: person("Ivy"),
        until: null,
        next: mdText`@bob`,
        moment: at,
      }).toString(),
    ).toBe(
      `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) through schedule Primary: **Ivy** is on call but hasn't joined the project yet. @bob is next.`,
    );
    expect(
      OnCallChatText.nobodyPaged({
        policy: POLICY,
        schedule: "Primary",
        onCall: person("Ivy"),
        until: null,
        moment: at,
      }).toString(),
    ).toBe(
      `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) through schedule Primary: **Ivy** is on call but hasn't joined the project yet.`,
    );
  });

  test("why: not joined yet, or not a member - with a name, and without one", () => {
    const why: (
      name: string,
      because: OnCallNotPagedBecause,
      isNext: boolean,
    ) => string = (
      name: string,
      because: OnCallNotPagedBecause,
      isNext: boolean,
    ): string => {
      return OnCallChatText.whyNotPaged({
        person: person(name, because),
        isNext: isNext,
      }).toString();
    };

    const { NotJoinedYet, NotAMember } = OnCallNotPagedBecause;

    expect([
      why("Ivy", NotJoinedYet, false),
      why("", NotJoinedYet, false),
      why("Ivy", NotJoinedYet, true),
      why("", NotJoinedYet, true),
      why("Cy", NotAMember, false),
      why("", NotAMember, false),
      why("Cy", NotAMember, true),
      why("", NotAMember, true),
    ]).toEqual([
      "**Ivy** is on call but hasn't joined the project yet",
      "the person on call hasn't joined the project yet",
      "**Ivy** is next but hasn't joined the project yet",
      "the next person hasn't joined the project yet",
      "**Cy** is on call but isn't a member of the project",
      "the person on call isn't a member of the project",
      "**Cy** is next but isn't a member of the project",
      "the next person isn't a member of the project",
    ]);
  });

  test("REGRESSION: an invitee next is no one to take over - then nobody", () => {
    expect(
      OnCallChatText.nowOnCall({
        person: mdText`@ana`,
        policy: POLICY,
        until: HANDOFF_AT,
        nextNotPaged: person("Ivy"),
        moment: at,
      }).toString(),
    ).toBe(
      `📞 @ana is now on call for [Payments](${POLICY_LINK}) until 22:50 UTC, then nobody: **Ivy** is next but hasn't joined the project yet.`,
    );
    expect(
      OnCallChatText.nowOnCall({
        person: mdText`@ana`,
        policy: POLICY,
        until: null,
        nextNotPaged: person(""),
        moment: at,
      }).toString(),
    ).toBe(
      `📞 @ana is now on call for [Payments](${POLICY_LINK}), then nobody: the next person hasn't joined the project yet.`,
    );
  });

  test("REGRESSION: an invitee next, alone: nobody will be paged from then", () => {
    expect(
      OnCallChatText.nextOnCall({
        person: mdText``,
        policy: POLICY,
        from: HANDOFF_AT,
        notPaged: person("Ivy"),
        schedule: "Primary",
        moment: at,
      }).toString(),
    ).toBe(
      `⚠️ Nobody will be paged for [Payments](${POLICY_LINK}) through schedule Primary from 22:50 UTC: **Ivy** is next but hasn't joined the project yet.`,
    );
    expect(
      OnCallChatText.nextOnCall({
        person: mdText``,
        policy: POLICY,
        from: null,
        notPaged: person("Ivy"),
        schedule: "Primary",
        moment: at,
      }).toString(),
    ).toBe(
      `⚠️ Nobody will be paged for [Payments](${POLICY_LINK}) through schedule Primary after this shift: **Ivy** is next but hasn't joined the project yet.`,
    );
  });

  test("nobody on call, and an invitee next: nobody will be paged then either", () => {
    expect(
      OnCallChatText.nobodyOnCall({
        policy: POLICY,
        nextNotPaged: person("Ivy"),
        from: HANDOFF_AT,
        moment: at,
      }).toString(),
    ).toBe(
      `⚠️ Nobody is on call for [Payments](${POLICY_LINK}), and nobody will be paged from 22:50 UTC either: **Ivy** is next but hasn't joined the project yet.`,
    );
    expect(
      OnCallChatText.nobodyOnCall({
        policy: POLICY,
        nextNotPaged: person("Ivy"),
        from: null,
        moment: at,
      }).toString(),
    ).toBe(
      `⚠️ Nobody is on call for [Payments](${POLICY_LINK}), and nobody will be paged on the next shift either: **Ivy** is next but hasn't joined the project yet.`,
    );
  });

  test("somebody who joined during their turn: a page reaches them from now on", () => {
    expect(
      OnCallChatText.nowOnCall({
        person: mdText`@ivy`,
        policy: POLICY,
        until: HANDOFF_AT,
        next: mdText`@bob`,
        hasJustJoined: true,
        moment: at,
      }).toString(),
    ).toBe(
      `📞 @ivy has joined the project and is now on call for [Payments](${POLICY_LINK}) until 22:50 UTC, then @bob.`,
    );
    expect(
      OnCallChatText.nextOnCall({
        person: mdText`@ivy`,
        policy: POLICY,
        from: HANDOFF_AT,
        hasJustJoined: true,
        moment: at,
      }).toString(),
    ).toBe(
      `➡️ @ivy has joined the project and is next on call for [Payments](${POLICY_LINK}), from 22:50 UTC.`,
    );
  });

  test("through which schedule: its name is text; none for a schedule with no name", () => {
    expect(OnCallChatText.throughSchedule("Primary").toString()).toBe(
      " through schedule Primary",
    );
    expect(OnCallChatText.throughSchedule("  ").toString()).toBe("");
    expect(OnCallChatText.throughSchedule(undefined).toString()).toBe("");
    expect(
      OnCallChatText.throughSchedule("[Primary](https://evil.test)").toString(),
    ).not.toContain("[Primary](https://evil.test)");
  });

  test("the lines every member's hand-off had stay word for word", () => {
    expect(
      OnCallChatText.nowOnCall({
        person: mdText`@ana`,
        policy: POLICY,
        until: HANDOFF_AT,
        next: mdText`@bob`,
        moment: at,
      }).toString(),
    ).toBe(
      `📞 @ana is now on call for [Payments](${POLICY_LINK}) until 22:50 UTC, then @bob.`,
    );
    expect(
      OnCallChatText.nowOnCall({
        person: mdText`@ana`,
        policy: POLICY,
        until: null,
        next: mdText`@bob`,
        moment: at,
      }).toString(),
    ).toBe(
      `📞 @ana is now on call for [Payments](${POLICY_LINK}). @bob is next.`,
    );
    expect(
      OnCallChatText.nextOnCall({
        person: mdText`@bob`,
        policy: POLICY,
        from: HANDOFF_AT,
        moment: at,
      }).toString(),
    ).toBe(
      `➡️ @bob is next on call for [Payments](${POLICY_LINK}), from 22:50 UTC.`,
    );
  });

  test("each is one short line", () => {
    const lines: Array<string> = [
      OnCallChatText.nobodyPaged({
        policy: POLICY,
        schedule: "Primary",
        onCall: person("Ivy"),
        until: HANDOFF_AT,
        next: mdText`@bob`,
        moment: at,
      }).toString(),
      OnCallChatText.nowOnCall({
        person: mdText`@ana`,
        policy: POLICY,
        until: HANDOFF_AT,
        nextNotPaged: person("Ivy"),
        moment: at,
      }).toString(),
      OnCallChatText.nobodyOnCall({
        policy: POLICY,
        nextNotPaged: person("Ivy"),
        from: HANDOFF_AT,
        moment: at,
      }).toString(),
    ];

    for (const line of lines) {
      expect(line.split("\n")).toHaveLength(1);
      expect(line.length).toBeLessThan(240);
      expect(line).not.toMatch(/escalation rule|with order|GMT/i);
    }
  });
});

describe("what a change says, when nothing pages somebody it names", () => {
  test("REGRESSION: an invitee coming on call is nobody paged, not somebody on call", () => {
    expect(OnCallHandoffPosts.getChange(ivyOnCall())).toBe(
      OnCallHandoffChange.NobodyPaged,
    );
    // After a gap, and after another invitee's turn, too.
    expect(
      OnCallHandoffPosts.getChange(ivyOnCall({ previousUserId: null })),
    ).toBe(OnCallHandoffChange.NobodyPaged);
    expect(
      OnCallHandoffPosts.getChange(ivyOnCall({ previousUserId: CARL })),
    ).toBe(OnCallHandoffChange.NobodyPaged);
  });

  test("a member after an invitee's turn is somebody on call again", () => {
    expect(
      OnCallHandoffPosts.getChange(
        handoff({ previousUserId: IVY, currentUserId: BOB }),
      ),
    ).toBe(OnCallHandoffChange.NowOnCall);
  });

  test("the same invitee staying on call, a handoff time moving on, says nothing", () => {
    expect(
      OnCallHandoffPosts.getChange(
        ivyOnCall({ previousUserId: IVY, previousNextUserId: BOB }),
      ),
    ).toBeNull();
  });

  test("an invitee becoming next is who is next - said as nobody paged then", () => {
    expect(
      OnCallHandoffPosts.getChange(
        ivyNext({ previousUserId: ANA, previousNextUserId: CARL }),
      ),
    ).toBe(OnCallHandoffChange.NextOnCall);
  });

  test("who is a member left out: everyone is, as before", () => {
    expect(OnCallHandoffPosts.isCurrentUserPaged(handoff())).toBe(true);
    expect(OnCallHandoffPosts.isNextUserPaged(handoff())).toBe(true);
    expect(OnCallHandoffPosts.getChange(handoff())).toBe(
      OnCallHandoffChange.NowOnCall,
    );
  });

  test("somebody who joined during their turn is on call, or next, from now on", () => {
    expect(
      OnCallHandoffPosts.getChange(
        handoff({
          previousUserId: IVY,
          currentUserId: IVY,
          previousNextUserId: BOB,
          currentUserJustJoined: true,
        }),
      ),
    ).toBe(OnCallHandoffChange.NowOnCall);
    expect(
      OnCallHandoffPosts.getChange(
        handoff({
          previousUserId: ANA,
          previousNextUserId: IVY,
          nextUserId: IVY,
          nextUserJustJoined: true,
        }),
      ),
    ).toBe(OnCallHandoffChange.NextOnCall);
  });

  test("a join that pages nobody new says nothing: not a member after all, or next and on call at once", () => {
    expect(
      OnCallHandoffPosts.getChange(
        handoff({
          previousUserId: IVY,
          currentUserId: IVY,
          currentUserIsMember: false,
          currentUserJustJoined: true,
        }),
      ),
    ).toBeNull();
    expect(
      OnCallHandoffPosts.getChange(
        handoff({
          previousUserId: IVY,
          currentUserId: IVY,
          previousNextUserId: IVY,
          nextUserId: IVY,
          nextUserJustJoined: true,
        }),
      ),
    ).toBeNull();
  });
});

describe("where the lines of a turn nothing pages go", () => {
  function lines(change: OnCallHandoff): Array<OnCallChatLine> {
    return OnCallHandoffPosts.getChatPosts(change).map(
      (post: OnCallChatPost): OnCallChatLine => {
        return post.line;
      },
    );
  }

  test("REGRESSION: an invitee's turn is one message, to the channels that want nobody on call", () => {
    expect(OnCallHandoffPosts.getChatPosts(ivyOnCall())).toEqual([
      { line: OnCallChatLine.NobodyPaged, updateKinds: [NobodyOnCall] },
    ]);
  });

  test("an invitee next changes no message, only what it says", () => {
    expect(lines(ivyNext())).toEqual([
      OnCallChatLine.NowOnCallThenNext,
      OnCallChatLine.NowOnCall,
      OnCallChatLine.NextOnCall,
    ]);
  });

  test("a join: who is on call now, never a second who-is-next line; or who is next alone", () => {
    expect(
      lines(
        handoff({
          previousUserId: IVY,
          currentUserId: IVY,
          previousNextUserId: BOB,
          currentUserJustJoined: true,
        }),
      ),
    ).toEqual([OnCallChatLine.NowOnCallThenNext, OnCallChatLine.NowOnCall]);
    expect(
      OnCallHandoffPosts.getChatPosts(
        handoff({
          previousUserId: ANA,
          previousNextUserId: IVY,
          nextUserId: IVY,
          nextUserJustJoined: true,
        }),
      ),
    ).toEqual([{ line: OnCallChatLine.NextOnCall, updateKinds: [OnCallNext] }]);
  });

  test("through the real rules: an invitee's turn reaches the channels that want a gap, and no other", async () => {
    function rule(
      channelNames: string,
      updatesToPost?: Array<NotificationRuleUpdateKind>,
    ): WorkspaceNotificationRule {
      const workspaceRule: WorkspaceNotificationRule =
        new WorkspaceNotificationRule();
      workspaceRule.id = ObjectID.generate();
      workspaceRule.projectId = PROJECT_ID;
      workspaceRule.workspaceType = WorkspaceType.Slack;
      workspaceRule.eventType = NotificationRuleEventType.OnCallDutyPolicy;
      workspaceRule.name = channelNames;
      workspaceRule.notificationRule = {
        _type: "OnCallDutyPolicyNotificationRule",
        filterCondition: FilterCondition.All,
        filters: [],
        shouldPostToExistingChannel: true,
        existingChannelNames: channelNames,
        ...(updatesToPost ? { updatesToPost: updatesToPost } : {}),
      } as BaseNotificationRule;
      return workspaceRule;
    }

    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue([
        rule("legacy"),
        rule(
          "key",
          NotificationRuleUpdates.getNewRuleUpdatesToPost(
            NotificationRuleEventType.OnCallDutyPolicy,
          ),
        ),
        rule("now-only", [OnCallNow]),
        rule("next-only", [OnCallNext]),
      ]);
    jest
      .spyOn(
        WorkspaceNotificationRuleService as never,
        "getWorkspaceChannelsByNotificationFor",
      )
      .mockResolvedValue([] as never);

    const heard: Record<string, Array<string>> = {};

    for (const post of OnCallHandoffPosts.getChatPosts(ivyOnCall())) {
      const destinations: Array<WorkspaceMessagePayload> =
        await WorkspaceNotificationRuleService.getMessageDestinationsWanting({
          projectId: PROJECT_ID,
          notificationFor: { onCallDutyPolicyId: POLICY_ID },
          workspaceType: WorkspaceType.Slack,
          updateKinds: post.updateKinds,
          alsoWantedUpdateKinds: post.alsoWantedUpdateKinds,
          notWantedUpdateKinds: post.notWantedUpdateKinds,
        });

      for (const destination of destinations) {
        for (const name of destination.channelNames) {
          heard[name] = [...(heard[name] || []), post.line];
        }
      }
    }

    // It was "📞 Ivy is now on call" in "now-only", "key" and "legacy".
    expect(heard).toEqual({
      legacy: [OnCallChatLine.NobodyPaged],
      key: [OnCallChatLine.NobodyPaged],
    });
  });
});

/*
 * The policy's feed and channels, through the real post: who is named how,
 * what is read, and where each line goes.
 */
describe("posting a turn nothing pages", () => {
  let rows: Array<OnCallDutyPolicyFeed>;
  let sends: Array<
    Parameters<
      typeof WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification
    >[0]
  >;
  // The names typed with invitations, by user id.
  let typedNames: Map<string, string | null>;

  function connect(workspaceTypes: Array<WorkspaceType>): void {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue(
        workspaceTypes.map(
          (workspaceType: WorkspaceType): WorkspaceProjectAuthToken => {
            const auth: WorkspaceProjectAuthToken =
              new WorkspaceProjectAuthToken();
            auth.workspaceType = workspaceType;
            auth.authToken = "token";
            return auth;
          },
        ),
      );
  }

  // Every word a channel was sent: each workspace's line, and the one for the others.
  function everythingChannelsHeard(): Array<string> {
    return sends.flatMap((send: (typeof sends)[number]): Array<string> => {
      return [
        send.feedInfoInMarkdown,
        ...Object.values(send.markdownByWorkspaceType || {}),
      ];
    });
  }

  beforeEach(() => {
    rows = [];
    sends = [];
    typedNames = new Map<string, string | null>([[IVY.toString(), "Ivy"]]);

    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(URL.fromString(POLICY_LINK));
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneBy")
      .mockResolvedValue(null);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockImplementation((async (data: { userId: ObjectID }) => {
        return mdText`[${PROJECT_NAMES[data.userId.toString()] || "?"}](https://oneuptime.test/users/${data.userId.toString()})`;
      }) as never);
    jest
      .spyOn(WorkspaceUtil, "getUserStringForWorkspace")
      .mockImplementation((async (data: { userId: ObjectID }) => {
        // As a workspace names somebody who connected no account: as the project does.
        return `@${(PROJECT_NAMES[data.userId.toString()] || "?").toLowerCase()} `;
      }) as never);
    jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockImplementation((async (data: { userIds: Array<string> }) => {
        const withheld: Map<string, WithheldProfile> = new Map();

        for (const userId of data.userIds) {
          if (typedNames.has(userId)) {
            withheld.set(userId.toLowerCase(), {
              inviteeName: typedNames.get(userId) || null,
              inviteeEmail: IVY_ADDRESS,
            });
          }
        }

        return withheld;
      }) as never);
    jest.spyOn(UserService, "findBy").mockImplementation((async () => {
      // Somebody who left keeps their own name: Carl's.
      const user: User = new User();
      user._id = CARL.toString();
      user.name = new Name("Carl");
      return [user];
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
      .mockImplementation((async (
        data: Parameters<
          typeof WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification
        >[0],
      ) => {
        sends.push(data);
      }) as never);

    connect([WorkspaceType.Slack]);
  });

  test("REGRESSION: an invitee's turn: a gap in the feed, and nobody paged in the channels that want a gap", async () => {
    await OnCallHandoffPosts.post(ivyOnCall());

    expect(rows).toHaveLength(1);
    expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
      OnCallDutyPolicyFeedEventType.CoverageGapStarted,
    );
    expect(rows[0]!.displayColor?.toString()).toBe(Red500.toString());
    expect(rows[0]!.userId).toBeUndefined();
    /*
     * The feed names them as the channels do (#10616): by the name typed
     * with the invitation - it is posted to the channels, and read beyond
     * the project too. Its members keep their links.
     */
    const feed: string = rows[0]!.feedInfoInMarkdown || "";

    expect(
      feed.startsWith(
        `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) through schedule Primary until Nov 14, 2026, `,
      ),
    ).toBe(true);
    expect(
      feed.endsWith(
        ` EST, when **[Bob](https://oneuptime.test/users/${BOB.toString()})** takes over: **Ivy** is on call but hasn't joined the project yet.`,
      ),
    ).toBe(true);

    expect(sends).toHaveLength(1);
    expect(sends[0]!.workspaceNotification.updateKinds).toEqual([NobodyOnCall]);
    expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) through schedule Primary until ${SLACK_UNTIL}, when @bob takes over: **Ivy** is on call but hasn't joined the project yet.`,
    );

    // It was "📞 Ivy is now on call for Payments ..." everywhere.
    for (const words of [
      rows[0]!.feedInfoInMarkdown!,
      ...everythingChannelsHeard(),
    ]) {
      expect(words).not.toContain("is now on call");
    }
  });

  test("the schedule is named once, through it - a policy that pages another schedule too has no second name for it", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneBy")
      .mockResolvedValue(new OnCallDutyPolicyEscalationRuleSchedule());

    await OnCallHandoffPosts.post(ivyOnCall());
    await OnCallHandoffPosts.post(
      ivyNext({ previousUserId: ANA, previousNextUserId: CARL }),
    );

    expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) through schedule Primary until ${SLACK_UNTIL}, when @bob takes over: **Ivy** is on call but hasn't joined the project yet.`,
    );
    expect(sends[1]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `⚠️ Nobody will be paged for [Payments](${POLICY_LINK}) through schedule Primary from ${SLACK_UNTIL}: **Ivy** is next but hasn't joined the project yet.`,
    );
  });

  test("a schedule with no name: the line says the policy alone", async () => {
    await OnCallHandoffPosts.post(ivyOnCall({ scheduleName: "  " }));

    expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) until ${SLACK_UNTIL}, when @bob takes over: **Ivy** is on call but hasn't joined the project yet.`,
    );
  });

  test("REGRESSION: never their email address in a channel or in the policy's feed - not with no name typed, not when the name typed is one", async () => {
    connect([
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Mattermost,
    ]);

    for (const typed of [null, "  ", IVY_ADDRESS]) {
      sends = [];
      rows = [];
      typedNames.set(IVY.toString(), typed);

      await OnCallHandoffPosts.post(ivyOnCall());
      await OnCallHandoffPosts.post(ivyNext());

      expect(sends.length).toBeGreaterThan(0);
      expect(rows.length).toBeGreaterThan(0);

      for (const words of [
        ...everythingChannelsHeard(),
        ...rows.map((row: OnCallDutyPolicyFeed): string => {
          return row.feedInfoInMarkdown || "";
        }),
      ]) {
        expect(words).not.toContain("acme.test");
        expect(words).not.toContain(IVY.toString());
      }

      // The feed says it as the channels do (#10616).
      expect(rows[0]!.feedInfoInMarkdown).toContain(
        ": the person on call hasn't joined the project yet.",
      );
      expect(rows[1]!.feedInfoInMarkdown).toContain(
        ", then nobody: the next person hasn't joined the project yet.",
      );

      expect(
        sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack],
      ).toContain(": the person on call hasn't joined the project yet.");
      expect(
        sends[1]!.markdownByWorkspaceType?.[WorkspaceType.Mattermost],
      ).toContain(
        ", then nobody: the next person hasn't joined the project yet.",
      );
    }
  });

  test("their display name is text, never Markdown of its own", async () => {
    const typed: string = "[Click](https://evil.test) <!channel>";
    typedNames.set(IVY.toString(), typed);

    await OnCallHandoffPosts.post(ivyOnCall());

    const line: string =
      sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack] || "";

    expect(line).not.toContain("[Click](https://evil.test)");
    expect(line).not.toContain("<!channel>");
    expect(line).toContain(
      `${mdText`**${typed}**`.toString()} is on call but hasn't joined the project yet.`,
    );
  });

  test("REGRESSION: an invitee next - then nobody, where a channel wants who is next; and nobody will be paged, where it wants only that", async () => {
    await OnCallHandoffPosts.post(ivyNext());

    expect(
      sends.map((send: (typeof sends)[number]) => {
        return {
          updateKinds: send.workspaceNotification.updateKinds,
          slack: send.markdownByWorkspaceType?.[WorkspaceType.Slack],
        };
      }),
    ).toEqual([
      {
        updateKinds: [OnCallNow],
        slack: `📞 @ana is now on call for [Payments](${POLICY_LINK}) until ${SLACK_UNTIL}, then nobody: **Ivy** is next but hasn't joined the project yet.`,
      },
      {
        updateKinds: [OnCallNow],
        slack: `📞 @ana is now on call for [Payments](${POLICY_LINK}) until ${SLACK_UNTIL}.`,
      },
      {
        updateKinds: [OnCallNext],
        slack: `⚠️ Nobody will be paged for [Payments](${POLICY_LINK}) through schedule Primary from ${SLACK_UNTIL}: **Ivy** is next but hasn't joined the project yet.`,
      },
    ]);

    // Ana's hand-off, in green, about Ana.
    expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
      OnCallDutyPolicyFeedEventType.RosterHandoff,
    );
    expect(rows[0]!.displayColor?.toString()).toBe(Green500.toString());
    expect(rows[0]!.userId?.toString()).toBe(ANA.toString());
    expect(rows[0]!.feedInfoInMarkdown).toContain(
      `, then nobody: **Ivy** is next but hasn't joined the project yet.`,
    );
  });

  test("only an invitee becoming next: a warning in the feed, to the channels that want who is next", async () => {
    await OnCallHandoffPosts.post(
      ivyNext({ previousUserId: ANA, previousNextUserId: CARL }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
      OnCallDutyPolicyFeedEventType.RosterHandoff,
    );
    expect(rows[0]!.displayColor?.toString()).toBe(Yellow500.toString());
    expect(rows[0]!.userId?.toString()).toBe(IVY.toString());
    expect(rows[0]!.feedInfoInMarkdown).toMatch(
      /^⚠️ Nobody will be paged for \[Payments\]\(.+\) through schedule Primary from Nov 14, 2026, .+ EST: \*\*Ivy\*\* is next but hasn't joined the project yet\.$/,
    );
    expect(sends).toHaveLength(1);
    expect(sends[0]!.workspaceNotification.updateKinds).toEqual([OnCallNext]);
  });

  test("nobody on call, and an invitee next: the gap says nobody will be paged then either", async () => {
    await OnCallHandoffPosts.post(
      ivyNext({ currentUserId: null, handoffAt: null }),
    );

    expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
      OnCallDutyPolicyFeedEventType.CoverageGapStarted,
    );
    expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `⚠️ Nobody is on call for [Payments](${POLICY_LINK}), and nobody will be paged from ${SLACK_UNTIL} either: **Ivy** is next but hasn't joined the project yet.`,
    );
  });

  test("an invitee on call with an invitee next: nobody takes over either, and nobody is named for it", async () => {
    await OnCallHandoffPosts.post(
      ivyOnCall({ nextUserId: CARL, nextUserIsMember: false }),
    );

    expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) through schedule Primary until ${SLACK_UNTIL}: **Ivy** is on call but hasn't joined the project yet.`,
    );
  });

  test("somebody no longer a member, still on the roster: named by their own name, not a member", async () => {
    await OnCallHandoffPosts.post(
      handoff({
        previousUserId: ANA,
        currentUserId: CARL,
        currentUserIsMember: false,
      }),
    );

    expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) through schedule Primary until ${SLACK_UNTIL}, when @bob takes over: **Carl** is on call but isn't a member of the project.`,
    );
  });

  test("who is only invited could not be read: not a member, with no name - and the gap is still posted", async () => {
    jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockRejectedValue(new Error("unreachable") as never);

    await OnCallHandoffPosts.post(ivyOnCall());

    expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
      OnCallDutyPolicyFeedEventType.CoverageGapStarted,
    );
    /*
     * Nobody's standing could be read, Bob's neither: nobody is named by
     * what could be an invitee's address (#10616), so he is Somebody.
     */
    expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `⚠️ Nobody is paged for [Payments](${POLICY_LINK}) through schedule Primary until ${SLACK_UNTIL}, when Somebody takes over: the person on call isn't a member of the project.`,
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Could not read who an on-call handoff names that nothing pages; they are said to be no members, with no name.",
      expect.anything(),
    );
  });

  test("everybody paged: nobody is read as somebody nothing pages, and each person named is asked once whether they are only invited", async () => {
    connect([
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Mattermost,
    ]);

    await OnCallHandoffPosts.post(handoff());

    // Ana on call and Bob next: once each, for the feed and every channel (#10616).
    expect(
      (
        PendingInviteeProfiles.readWithheldProfilesInProject as unknown as jest.Mock
      ).mock.calls.map((call: Array<unknown>): Array<string> => {
        return (call[0] as { userIds: Array<string> }).userIds;
      }),
    ).toEqual([[ANA.toString()], [BOB.toString()]]);
    expect(UserService.findBy).not.toHaveBeenCalled();
  });

  test("nobody a page cannot reach is mentioned: an invitee's turn asks no workspace for their account", async () => {
    jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockResolvedValue(null as never);

    await OnCallHandoffPosts.post(ivyOnCall());

    expect(WorkspaceUserAuthTokenService.getUserAuth).not.toHaveBeenCalled();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.workspaceNotification.mentioning).toBeUndefined();
  });

  /*
   * IVY JOINS DURING HER SHIFT (#10586). The hand-off that put her on call
   * said nobody was paged until it ended; once she joins, a page reaches
   * her, and each policy that pages the schedule hears it once.
   */
  describe("joining during the shift", () => {
    let onCallIn: Array<OnCallDutyPolicySchedule>;
    let nextIn: Array<OnCallDutyPolicySchedule>;
    let attachments: Array<OnCallDutyPolicyEscalationRuleSchedule>;

    function schedule(data: {
      onCall: ObjectID | null;
      next: ObjectID | null;
    }): OnCallDutyPolicySchedule {
      const model: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      model._id = SCHEDULE_ID.toString();

      if (data.onCall) {
        model.currentUserIdOnRoster = data.onCall;
        model.rosterHandoffAt = HANDOFF_AT;
      }

      if (data.next) {
        model.nextUserIdOnRoster = data.next;
        model.rosterNextStartAt = HANDOFF_AT;
      }

      return model;
    }

    function attachment(data: {
      policyId: ObjectID;
      policyName: string;
      pageNextInRotation?: boolean;
    }): OnCallDutyPolicyEscalationRuleSchedule {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.id = data.policyId;
      policy.name = data.policyName;

      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.id = ObjectID.generate();
      rule.name = "Level 1";
      rule.order = 1;

      const scheduleModel: OnCallDutyPolicySchedule =
        new OnCallDutyPolicySchedule();
      scheduleModel.id = SCHEDULE_ID;
      scheduleModel.name = "Primary";
      scheduleModel.timezone = Timezone.AmericaNew_York;

      const row: OnCallDutyPolicyEscalationRuleSchedule =
        new OnCallDutyPolicyEscalationRuleSchedule();
      row.id = ObjectID.generate();
      row.projectId = PROJECT_ID;
      row.onCallDutyPolicyScheduleId = SCHEDULE_ID;
      row.pageNextInRotation = Boolean(data.pageNextInRotation);
      row.onCallDutyPolicy = policy;
      row.onCallDutyPolicyEscalationRule = rule;
      row.onCallDutyPolicySchedule = scheduleModel;
      return row;
    }

    beforeEach(() => {
      onCallIn = [];
      nextIn = [];
      attachments = [
        attachment({ policyId: POLICY_ID, policyName: "Payments" }),
      ];

      // Ivy has joined: the project calls her by her own name now.
      PROJECT_NAMES[IVY.toString()] = "Ivy";
      // ...and she is only invited no more.
      typedNames.delete(IVY.toString());

      jest
        .spyOn(OnCallDutyPolicyScheduleService, "findBy")
        .mockImplementation((async (args: {
          query: Record<string, unknown>;
        }) => {
          return args.query["currentUserIdOnRoster"] ? onCallIn : nextIn;
        }) as never);
      jest
        .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
        .mockImplementation((async () => {
          return attachments;
        }) as never);
      jest
        .spyOn(ProjectMembership, "getMemberUserIds")
        .mockImplementation((async (data: { userIds: Array<ObjectID> }) => {
          return new Set<string>(
            data.userIds.map((userId: ObjectID): string => {
              return userId.toString().toLowerCase();
            }),
          );
        }) as never);
    });

    afterEach(() => {
      PROJECT_NAMES[IVY.toString()] = IVY_ADDRESS;
    });

    async function joined(): Promise<void> {
      await OnCallHandoffPosts.postJoinedDuringShift({
        projectId: PROJECT_ID,
        userId: IVY,
      });
    }

    test("REGRESSION: on call when she joins: the channels that heard nobody was paged hear that she is on call now", async () => {
      onCallIn = [schedule({ onCall: IVY, next: BOB })];

      await joined();

      expect(
        sends.map((send: (typeof sends)[number]) => {
          return {
            updateKinds: send.workspaceNotification.updateKinds,
            slack: send.markdownByWorkspaceType?.[WorkspaceType.Slack],
          };
        }),
      ).toEqual([
        {
          updateKinds: [OnCallNow],
          slack: `📞 @ivy has joined the project and is now on call for [Payments](${POLICY_LINK}) until ${SLACK_UNTIL}, then @bob.`,
        },
        {
          updateKinds: [OnCallNow],
          slack: `📞 @ivy has joined the project and is now on call for [Payments](${POLICY_LINK}) until ${SLACK_UNTIL}.`,
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
        OnCallDutyPolicyFeedEventType.RosterHandoff,
      );
      expect(rows[0]!.userId?.toString()).toBe(IVY.toString());
      expect(rows[0]!.feedInfoInMarkdown).toMatch(
        /^📞 \*\*\[Ivy\]\(.+\)\*\* has joined the project and is now on call for \[Payments\]/,
      );
    });

    test("next when she joins: the channels that want who is next hear she is", async () => {
      nextIn = [schedule({ onCall: ANA, next: IVY })];

      await joined();

      expect(sends).toHaveLength(1);
      expect(sends[0]!.workspaceNotification.updateKinds).toEqual([OnCallNext]);
      expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
        `➡️ @ivy has joined the project and is next on call for [Payments](${POLICY_LINK}), from ${SLACK_UNTIL}.`,
      );
    });

    test("whoever else the roster names is said as a page reaches them: a next person not joined either is no one to take over", async () => {
      onCallIn = [schedule({ onCall: IVY, next: CARL })];
      jest
        .spyOn(ProjectMembership, "getMemberUserIds")
        .mockResolvedValue(new Set<string>() as never);

      await joined();

      expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
        `📞 @ivy has joined the project and is now on call for [Payments](${POLICY_LINK}) until ${SLACK_UNTIL}, then nobody: **Carl** is next but isn't a member of the project.`,
      );
    });

    test("each policy that pages the schedule hears it once; a rule that pages only the next in rotation, nothing", async () => {
      onCallIn = [schedule({ onCall: IVY, next: BOB })];
      attachments = [
        attachment({ policyId: POLICY_ID, policyName: "Payments" }),
        attachment({ policyId: POLICY_ID, policyName: "Payments" }),
        attachment({ policyId: OTHER_POLICY_ID, policyName: "Checkout" }),
        attachment({
          policyId: ObjectID.generate(),
          policyName: "Warm standby",
          pageNextInRotation: true,
        }),
      ];

      await joined();

      expect(rows).toHaveLength(2);
      expect(
        rows.map((row: OnCallDutyPolicyFeed): string => {
          return row.onCallDutyPolicyId!.toString();
        }),
      ).toEqual([POLICY_ID.toString(), OTHER_POLICY_ID.toString()]);
    });

    test("on no roster: nothing more is read, nothing posted", async () => {
      await joined();

      expect(
        OnCallDutyPolicyEscalationRuleScheduleService.findBy,
      ).not.toHaveBeenCalled();
      expect(rows).toEqual([]);
      expect(sends).toEqual([]);
    });

    test("a read that fails is logged, never thrown", async () => {
      jest
        .spyOn(OnCallDutyPolicyScheduleService, "findBy")
        .mockRejectedValue(new Error("unreachable") as never);

      await expect(joined()).resolves.toBeUndefined();

      expect(rows).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        "Could not tell an on-call policy's channels that somebody on call joined the project.",
        expect.anything(),
      );
    });
  });
});
