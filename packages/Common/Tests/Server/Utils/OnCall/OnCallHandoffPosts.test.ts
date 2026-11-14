import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "../../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationRuleService, {
  Service as WorkspaceNotificationRuleServiceClass,
} from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import OnCallChatText from "../../../../Server/Utils/OnCall/OnCallChatText";
import OnCallHandoffPosts, {
  OnCallChatLine,
  OnCallChatPost,
  OnCallHandoff,
  OnCallHandoffChange,
} from "../../../../Server/Utils/OnCall/OnCallHandoffPosts";
import MattermostUtil from "../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import WorkspaceMessageTime from "../../../../Server/Utils/Workspace/WorkspaceMessageTime";
import URL from "../../../../Types/API/URL";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";
import BaseNotificationRule from "../../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
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
 * A HANDOFF IS ONE SHORT LINE PER POLICY, IN EACH CHANNEL THAT WANTS IT
 * (issue #7549).
 *
 * The customer's on-call channel heard every handoff three times over, for
 * every escalation rule of the policy that pages the schedule - who is no
 * longer on call, who is on call now, who is next - each naming the rule,
 * its order and both ends of the shift in several time zones. Now:
 *
 *   - a policy's channels hear one line: "📞 @Ana is now on call for
 *     Payments until Fri at 5:50 PM", the policy linked, the moment in each
 *     reader's own zone;
 *   - its rules choose the lines they post (who is on call now, who is
 *     next, nobody on call), and a channel never gets two lines of one
 *     handoff: the line with who is next where a rule wants both, the
 *     line without where a rule wants only who is on call now, who is next
 *     alone where a rule wants only that;
 *   - a rule saved before rules chose posts every update: the line with
 *     who is next;
 *   - the policy's feed keeps one entry of it, in the schedule's zone.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "75490000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "75490000-0000-4000-8000-000000000002",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "75490000-0000-4000-8000-000000000003",
);
const ANA: ObjectID = new ObjectID("75490000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("75490000-0000-4000-8000-0000000000b1");
const CARL: ObjectID = new ObjectID("75490000-0000-4000-8000-0000000000c1");

const POLICY_LINK: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/policies/2";

// Friday 14 November 2026, 22:50 UTC: 5:50 PM in New York.
const HANDOFF_AT: Date = new Date("2026-11-14T22:50:00.000Z");
const NEXT_HANDOFF_AT: Date = new Date("2026-11-15T22:50:00.000Z");

const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana",
  [BOB.toString()]: "Bob",
  [CARL.toString()]: "Carl",
};

const {
  OnCallNow,
  OnCallNext,
  NobodyOnCall,
  Overrides,
  PolicyChanges,
  Owners,
} = NotificationRuleUpdateKind;

// Ana takes over from Carl, until Friday; Bob is next.
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

// How a moment reads, for lines whose moments are not under test.
function at(date: Date): MarkdownText {
  return mdText`${date.toISOString().slice(11, 16)} UTC`;
}

const POLICY: MarkdownText = OnCallChatText.policy({
  name: "Payments",
  link: POLICY_LINK,
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the lines an on-call channel hears", () => {
  test("REGRESSION: a handoff is one short line - who, the policy linked, until when", () => {
    expect(
      OnCallChatText.nowOnCall({
        person: mdText`@ana`,
        policy: POLICY,
        until: HANDOFF_AT,
        moment: at,
      }).toString(),
    ).toBe(
      `📞 @ana is now on call for [Payments](${POLICY_LINK}) until 22:50 UTC.`,
    );
  });

  test("with who takes over then, where the line names them", () => {
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
  });

  test("a shift with no end, and a next person with no time, still read as a sentence", () => {
    expect(
      OnCallChatText.nowOnCall({
        person: mdText`@ana`,
        policy: POLICY,
        until: null,
        moment: at,
      }).toString(),
    ).toBe(`📞 @ana is now on call for [Payments](${POLICY_LINK}).`);
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
  });

  test("who is next, and from when", () => {
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

  test("nobody on call: until when, and who takes over - or that nobody will", () => {
    expect(
      OnCallChatText.nobodyOnCall({
        policy: POLICY,
        next: mdText`@bob`,
        from: HANDOFF_AT,
        moment: at,
      }).toString(),
    ).toBe(
      `⚠️ Nobody is on call for [Payments](${POLICY_LINK}) until 22:50 UTC, when @bob takes over.`,
    );
    expect(
      OnCallChatText.nobodyOnCall({
        policy: POLICY,
        from: null,
        moment: at,
      }).toString(),
    ).toBe(
      `⚠️ Nobody is on call for [Payments](${POLICY_LINK}), and no later shift is scheduled.`,
    );
  });

  test("no escalation rule, no order, no time zones: none of what the customer's channel was full of", () => {
    const lines: Array<string> = [
      OnCallChatText.nowOnCall({
        person: mdText`@ana`,
        policy: POLICY,
        until: HANDOFF_AT,
        next: mdText`@bob`,
        moment: (date: Date): MarkdownText => {
          return WorkspaceMessageTime.dateAndTime(date);
        },
      }).toString(),
      OnCallChatText.nobodyOnCall({
        policy: POLICY,
        next: mdText`@bob`,
        from: HANDOFF_AT,
        moment: (date: Date): MarkdownText => {
          return WorkspaceMessageTime.dateAndTime(date);
        },
      }).toString(),
    ];

    for (const line of lines) {
      expect(line).not.toMatch(/escalation rule|with order|GMT|roster/i);
      expect(line.split("\n")).toHaveLength(1);
      expect(line.length).toBeLessThan(220);
    }
  });

  test("a policy that pages more than one schedule names the one that changed", () => {
    expect(
      OnCallChatText.policy({
        name: "Payments",
        link: POLICY_LINK,
        scheduleName: "Primary",
      }).toString(),
    ).toBe(`[Payments](${POLICY_LINK}) (Primary)`);
    expect(
      OnCallChatText.policy({
        name: "Payments",
        link: POLICY_LINK,
        scheduleName: "  ",
      }).toString(),
    ).toBe(`[Payments](${POLICY_LINK})`);
  });

  test("a name typed with Markdown in it is text, not a link or a mention", () => {
    const line: string = OnCallChatText.policy({
      name: "[Click](https://evil.test) <!channel>",
      link: POLICY_LINK,
    }).toString();

    expect(line).not.toContain("](https://evil.test)");
    expect(line).not.toContain("<!channel>");
    expect(line).toContain(`(${POLICY_LINK})`);
  });

  test("a moment reads in each reader's own zone in Slack and Teams, and in UTC in Mattermost", () => {
    const line: string = OnCallChatText.nowOnCall({
      person: mdText`@ana`,
      policy: POLICY,
      until: HANDOFF_AT,
      moment: (date: Date): MarkdownText => {
        return WorkspaceMessageTime.dateAndTime(date);
      },
    }).toString();

    // Microsoft Teams: the card's own date and time functions.
    expect(line).toContain(
      "until {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}.",
    );

    // Slack: a date each reader sees in their zone.
    expect(WorkspaceMessageTime.toSlack(line)).toContain(
      `<!date^${HANDOFF_AT.getTime() / 1000}^{time}|22:50 UTC>`,
    );

    // REGRESSION: Mattermost showed the {{TIME(...)}} as it was written.
    const mattermost: string = MattermostUtil.getMessageText(line);

    expect(mattermost).not.toContain("{{");
    expect(mattermost).toContain("until 2026-11-14 at 22:50 UTC.");
  });
});

describe("the other on-call lines", () => {
  test("a change to the policy names who or what, and the policy - not the escalation rule or its order", () => {
    expect(
      OnCallChatText.policyChange({
        emoji: "📅",
        isAdded: true,
        what: mdText`schedule **Primary**`,
        policy: POLICY,
      }).toString(),
    ).toBe(
      `📅 Added schedule **Primary** to on-call policy [Payments](${POLICY_LINK}).`,
    );
    expect(
      OnCallChatText.policyChange({
        emoji: "👨🏻‍👩🏻‍👦🏻",
        isAdded: false,
        what: mdText`team **SRE**`,
        policy: POLICY,
      }).toString(),
    ).toBe(
      `👨🏻‍👩🏻‍👦🏻 Removed team **SRE** from on-call policy [Payments](${POLICY_LINK}).`,
    );
    expect(
      OnCallChatText.policyChange({
        emoji: "📅",
        isAdded: true,
        what: mdText`schedule **Weekend**`,
        policy: POLICY,
        then: mdText`⚠️ Nobody is on call in it right now.`,
      }).toString(),
    ).toBe(
      `📅 Added schedule **Weekend** to on-call policy [Payments](${POLICY_LINK}). ⚠️ Nobody is on call in it right now.`,
    );
  });

  test("an override: who covers for whom, or who is away and where their turns go", () => {
    expect(
      OnCallChatText.overrideAdded({
        policy: POLICY,
        person: mdText`Ana`,
        cover: mdText`Bob`,
        from: HANDOFF_AT,
        until: NEXT_HANDOFF_AT,
        moment: at,
      }).toString(),
    ).toBe(
      `🔁 Added an override on [Payments](${POLICY_LINK}): Bob covers for Ana from 22:50 UTC to 22:50 UTC.`,
    );
    expect(
      OnCallChatText.overrideAdded({
        policy: POLICY,
        person: mdText`Ana`,
        from: HANDOFF_AT,
        until: NEXT_HANDOFF_AT,
        moment: at,
      }).toString(),
    ).toBe(
      `🔁 Added an override on [Payments](${POLICY_LINK}): Ana is away from 22:50 UTC to 22:50 UTC, and their turns go to the next person in the rotation.`,
    );
    expect(
      OnCallChatText.overrideRemoved({
        policy: POLICY,
        person: mdText`Ana`,
      }).toString(),
    ).toBe(
      `❌ Removed an override on [Payments](${POLICY_LINK}): Ana is paged on their turns again.`,
    );
  });

  test("an override changed (#7630, #7631): the override as it is now, said as the add says it", () => {
    // Somebody covers now: who, for whom, from when to when.
    expect(
      OnCallChatText.overrideChanged({
        policy: POLICY,
        person: mdText`Ana`,
        cover: mdText`Carl`,
        from: HANDOFF_AT,
        until: NEXT_HANDOFF_AT,
        moment: at,
      }).toString(),
    ).toBe(
      `✏️ Changed an override on [Payments](${POLICY_LINK}): Carl covers for Ana from 22:50 UTC to 22:50 UTC.`,
    );

    // Nobody named to cover now: the rotation covers.
    expect(
      OnCallChatText.overrideChanged({
        policy: POLICY,
        person: mdText`Ana`,
        cover: undefined,
        from: HANDOFF_AT,
        until: NEXT_HANDOFF_AT,
        moment: at,
      }).toString(),
    ).toBe(
      `✏️ Changed an override on [Payments](${POLICY_LINK}): Ana is away from 22:50 UTC to 22:50 UTC, and their turns go to the next person in the rotation.`,
    );

    // A cover whose name came back empty reads as no cover, as the add does.
    expect(
      OnCallChatText.overrideChanged({
        policy: POLICY,
        person: mdText`Ana`,
        cover: mdText``,
        from: HANDOFF_AT,
        until: NEXT_HANDOFF_AT,
        moment: at,
      }).toString(),
    ).toContain("Ana is away from");
  });

  test("an override's line says each moment where the line goes, start then end", () => {
    const moments: Array<string> = [];
    const line: string = OnCallChatText.overrideChanged({
      policy: POLICY,
      person: mdText`Ana`,
      cover: mdText`Carl`,
      from: HANDOFF_AT,
      until: NEXT_HANDOFF_AT,
      moment: (date: Date): MarkdownText => {
        moments.push(date.toISOString());

        return mdText`<${date.toISOString()}>`;
      },
    }).toString();

    expect(moments).toEqual([
      HANDOFF_AT.toISOString(),
      NEXT_HANDOFF_AT.toISOString(),
    ]);
    expect(line).toBe(
      `✏️ Changed an override on [Payments](${POLICY_LINK}): Carl covers for Ana from <${HANDOFF_AT.toISOString()}> to <${NEXT_HANDOFF_AT.toISOString()}>.`,
    );
  });
});

describe("what a roster change says", () => {
  test("somebody else on call is a handoff", () => {
    expect(OnCallHandoffPosts.getChange(handoff())).toBe(
      OnCallHandoffChange.NowOnCall,
    );
    // Coverage resuming after a gap is a handoff too.
    expect(
      OnCallHandoffPosts.getChange(handoff({ previousUserId: null })),
    ).toBe(OnCallHandoffChange.NowOnCall);
  });

  test("somebody on call, then nobody, is nobody on call", () => {
    expect(
      OnCallHandoffPosts.getChange(
        handoff({ currentUserId: null, handoffAt: null }),
      ),
    ).toBe(OnCallHandoffChange.NobodyOnCall);
  });

  test("the same person on call with somebody else next is who is next", () => {
    expect(
      OnCallHandoffPosts.getChange(
        handoff({ previousUserId: ANA, previousNextUserId: CARL }),
      ),
    ).toBe(OnCallHandoffChange.NextOnCall);
  });

  test("REGRESSION: only the handoff time moving on - a rotation of one - says nothing", () => {
    expect(
      OnCallHandoffPosts.getChange(
        handoff({
          previousUserId: ANA,
          currentUserId: ANA,
          previousNextUserId: ANA,
          nextUserId: ANA,
        }),
      ),
    ).toBeNull();
    expect(
      OnCallHandoffPosts.getChange(
        handoff({
          previousUserId: null,
          currentUserId: null,
          previousNextUserId: null,
          nextUserId: null,
        }),
      ),
    ).toBeNull();
  });

  test("a next person who is the person on call is nobody next", () => {
    expect(
      OnCallHandoffPosts.getNextToName(handoff({ nextUserId: ANA })),
    ).toBeNull();
    expect(
      OnCallHandoffPosts.getNextToName(handoff({ nextUserId: null })),
    ).toBeNull();
    expect(OnCallHandoffPosts.getNextToName(handoff())?.toString()).toBe(
      BOB.toString(),
    );
  });
});

describe("the messages of a handoff, and where each goes", () => {
  function plans(change: OnCallHandoff): Array<string> {
    return OnCallHandoffPosts.getChatPosts(change).map(
      (post: OnCallChatPost): string => {
        return post.line;
      },
    );
  }

  test("a handoff with somebody next: one message each for the three ways a channel can want it", () => {
    expect(OnCallHandoffPosts.getChatPosts(handoff())).toEqual([
      {
        line: OnCallChatLine.NowOnCallThenNext,
        updateKinds: [OnCallNow],
        alsoWantedUpdateKinds: [OnCallNext],
      },
      {
        line: OnCallChatLine.NowOnCall,
        updateKinds: [OnCallNow],
        notWantedUpdateKinds: [OnCallNext],
      },
      {
        line: OnCallChatLine.NextOnCall,
        updateKinds: [OnCallNext],
        notWantedUpdateKinds: [OnCallNow],
      },
    ]);
  });

  test("who is next alone is not said again when they did not change", () => {
    expect(plans(handoff({ previousNextUserId: BOB }))).toEqual([
      OnCallChatLine.NowOnCallThenNext,
      OnCallChatLine.NowOnCall,
    ]);
  });

  test("nobody next: one line, for every channel that wants who is on call now", () => {
    expect(
      OnCallHandoffPosts.getChatPosts(handoff({ nextUserId: null })),
    ).toEqual([{ line: OnCallChatLine.NowOnCall, updateKinds: [OnCallNow] }]);
    expect(plans(handoff({ nextUserId: ANA }))).toEqual([
      OnCallChatLine.NowOnCall,
    ]);
  });

  test("nobody on call, and who is next with nobody new on call, are one message each", () => {
    expect(
      OnCallHandoffPosts.getChatPosts(
        handoff({ currentUserId: null, handoffAt: null }),
      ),
    ).toEqual([
      { line: OnCallChatLine.NobodyOnCall, updateKinds: [NobodyOnCall] },
    ]);
    expect(
      OnCallHandoffPosts.getChatPosts(
        handoff({ previousUserId: ANA, previousNextUserId: CARL }),
      ),
    ).toEqual([{ line: OnCallChatLine.NextOnCall, updateKinds: [OnCallNext] }]);
  });

  test("nothing to say, no message", () => {
    expect(
      OnCallHandoffPosts.getChatPosts(
        handoff({
          previousUserId: ANA,
          previousNextUserId: BOB,
        }),
      ),
    ).toEqual([]);
  });
});

/*
 * The channels of a policy's rules, through the real rule service: which
 * line of a handoff each one gets.
 */
describe("each channel gets one line of a handoff, the one its rules want", () => {
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

  const RULES: Array<WorkspaceNotificationRule> = [
    // Saved before rules chose: every update.
    rule("legacy"),
    // A new rule: who is on call now, and when nobody is.
    rule(
      "key",
      NotificationRuleUpdates.getNewRuleUpdatesToPost(
        NotificationRuleEventType.OnCallDutyPolicy,
      ),
    ),
    rule("now-and-next", [OnCallNow, OnCallNext]),
    rule("next-only", [OnCallNext]),
    // Two rules, one channel: one wants who is on call now, one who is next.
    rule("shared", [OnCallNow]),
    rule("shared", [OnCallNext]),
    // Wants none of a handoff.
    rule("overrides-only", [Overrides, PolicyChanges, Owners]),
  ];

  async function linesByChannel(
    change: OnCallHandoff,
  ): Promise<Record<string, Array<string>>> {
    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue(RULES);
    jest
      .spyOn(
        WorkspaceNotificationRuleService as never,
        "getWorkspaceChannelsByNotificationFor",
      )
      .mockResolvedValue([] as never);

    const heard: Record<string, Array<string>> = {};

    for (const post of OnCallHandoffPosts.getChatPosts(change)) {
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

    return heard;
  }

  test("REGRESSION: one line per channel - never the three messages of before", async () => {
    expect(await linesByChannel(handoff())).toEqual({
      legacy: [OnCallChatLine.NowOnCallThenNext],
      key: [OnCallChatLine.NowOnCall],
      "now-and-next": [OnCallChatLine.NowOnCallThenNext],
      "next-only": [OnCallChatLine.NextOnCall],
      // Either rule's wish, in one line.
      shared: [OnCallChatLine.NowOnCallThenNext],
    });
  });

  test("a gap reaches the channels that want nobody on call, and only them", async () => {
    expect(
      await linesByChannel(handoff({ currentUserId: null, handoffAt: null })),
    ).toEqual({
      legacy: [OnCallChatLine.NobodyOnCall],
      key: [OnCallChatLine.NobodyOnCall],
    });
  });

  test("a new next person, with the same person on call, reaches the channels that want who is next", async () => {
    expect(
      await linesByChannel(
        handoff({ previousUserId: ANA, previousNextUserId: CARL }),
      ),
    ).toEqual({
      legacy: [OnCallChatLine.NextOnCall],
      "now-and-next": [OnCallChatLine.NextOnCall],
      "next-only": [OnCallChatLine.NextOnCall],
      shared: [OnCallChatLine.NextOnCall],
    });
  });

  test("nobody next: the channels that want who is on call now hear the one line", async () => {
    expect(await linesByChannel(handoff({ nextUserId: null }))).toEqual({
      legacy: [OnCallChatLine.NowOnCall],
      key: [OnCallChatLine.NowOnCall],
      "now-and-next": [OnCallChatLine.NowOnCall],
      shared: [OnCallChatLine.NowOnCall],
    });
  });

  test("the destination key tells channels apart by workspace, team, name, id and chat", () => {
    const base: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.Slack,
      messageBlocks: [],
      channelNames: ["oncall"],
      channelIds: [],
    };

    const key: (payload: WorkspaceMessagePayload) => string = (
      payload: WorkspaceMessagePayload,
    ): string => {
      return WorkspaceNotificationRuleServiceClass.getDestinationKey(payload);
    };

    expect(key(base)).toBe(key({ ...base, messageBlocks: [] }));

    for (const other of [
      { ...base, workspaceType: WorkspaceType.Mattermost },
      { ...base, teamId: "T2" },
      { ...base, channelNames: ["oncall-2"] },
      { ...base, channelNames: [], channelIds: ["oncall"] },
      { ...base, channelNames: [], chatIds: ["oncall"] },
    ] as Array<WorkspaceMessagePayload>) {
      expect(key(other)).not.toBe(key(base));
    }
  });
});

describe("posting a policy's handoff", () => {
  let rows: Array<OnCallDutyPolicyFeed>;
  let sends: Array<
    Parameters<
      typeof WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification
    >[0]
  >;

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

  beforeEach(() => {
    rows = [];
    sends = [];

    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(URL.fromString(POLICY_LINK));
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneBy")
      .mockResolvedValue(null);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockImplementation((async (data: { userId: ObjectID }) => {
        return mdText`[${NAMES[data.userId.toString()] || "?"}](https://oneuptime.test/users/${data.userId.toString()})`;
      }) as never);
    jest
      .spyOn(WorkspaceUtil, "getUserStringForWorkspace")
      .mockImplementation((async (data: {
        userId: ObjectID;
        workspaceType: WorkspaceType;
      }) => {
        const name: string = (
          NAMES[data.userId.toString()] || "?"
        ).toLowerCase();

        // Bob never connected his Mattermost account: his OneUptime name.
        return data.workspaceType === WorkspaceType.Mattermost && name === "bob"
          ? "[Bob](https://oneuptime.test/users/bob) "
          : `@${name} `;
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

  test("one entry in the policy's feed, in the schedule's zone, about the person on call", async () => {
    await OnCallHandoffPosts.post(handoff());

    expect(rows).toHaveLength(1);
    expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
      OnCallDutyPolicyFeedEventType.RosterHandoff,
    );
    expect(rows[0]!.userId?.toString()).toBe(ANA.toString());
    expect(rows[0]!.feedInfoInMarkdown).toContain(
      `📞 **[Ana](https://oneuptime.test/users/${ANA.toString()})** is now on call for [Payments](${POLICY_LINK}) until `,
    );
    expect(rows[0]!.feedInfoInMarkdown).toContain(
      `, then **[Bob](https://oneuptime.test/users/${BOB.toString()})**.`,
    );
    // 5:50 PM in New York, where the schedule's handoffs are set.
    expect(rows[0]!.feedInfoInMarkdown).toMatch(
      /Nov 14 2026, (17:50|05:50 PM) EST/,
    );
    expect(rows[0]!.feedInfoInMarkdown).not.toContain("{{");
  });

  test("its channels: the line for each way a rule can want it, the person as each workspace knows them", async () => {
    await OnCallHandoffPosts.post(handoff());

    expect(
      sends.map((send: (typeof sends)[number]) => {
        return {
          updateKinds: send.workspaceNotification.updateKinds,
          also: send.workspaceNotification.alsoWantedUpdateKinds,
          not: send.workspaceNotification.notWantedUpdateKinds,
          slack: send.markdownByWorkspaceType?.[WorkspaceType.Slack],
          about: send.notificationFor,
        };
      }),
    ).toEqual([
      {
        updateKinds: [OnCallNow],
        also: [OnCallNext],
        not: undefined,
        slack: `📞 @ana is now on call for [Payments](${POLICY_LINK}) until {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}, then @bob.`,
        about: { onCallDutyPolicyId: POLICY_ID },
      },
      {
        updateKinds: [OnCallNow],
        also: undefined,
        not: [OnCallNext],
        slack: `📞 @ana is now on call for [Payments](${POLICY_LINK}) until {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}.`,
        about: { onCallDutyPolicyId: POLICY_ID },
      },
      {
        updateKinds: [OnCallNext],
        also: undefined,
        not: [OnCallNow],
        slack: `➡️ @bob is next on call for [Payments](${POLICY_LINK}), from {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}.`,
        about: { onCallDutyPolicyId: POLICY_ID },
      },
    ]);

    // Nobody leads the line: no author.
    for (const send of sends) {
      expect(send.workspaceNotification.authorUserId).toBeUndefined();
    }
  });

  test("in each connected workspace its own names; nowhere else asked", async () => {
    connect([WorkspaceType.Slack, WorkspaceType.Mattermost]);

    await OnCallHandoffPosts.post(handoff());

    expect(sends[0]!.markdownByWorkspaceType).toEqual({
      [WorkspaceType.Slack]: expect.stringContaining("@ana is now on call"),
      [WorkspaceType.Mattermost]: expect.stringContaining(
        "then [Bob](https://oneuptime.test/users/bob).",
      ),
    });
    expect(Object.keys(sends[0]!.markdownByWorkspaceType || {})).not.toContain(
      WorkspaceType.MicrosoftTeams,
    );
  });

  test("each person's name in a workspace is asked once, for every line", async () => {
    await OnCallHandoffPosts.post(handoff());

    // Ana and Bob, in Slack.
    expect(WorkspaceUtil.getUserStringForWorkspace).toHaveBeenCalledTimes(2);
  });

  test("a policy that pages another schedule too names this one", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneBy")
      .mockResolvedValue(new OnCallDutyPolicyEscalationRuleSchedule());

    await OnCallHandoffPosts.post(handoff());

    expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toContain(
      `on call for [Payments](${POLICY_LINK}) (Primary) until`,
    );
    expect(rows[0]!.feedInfoInMarkdown).toContain("(Primary)");
  });

  test("a gap: one feed entry and one line, nobody on call until the next person's turn", async () => {
    await OnCallHandoffPosts.post(
      handoff({ currentUserId: null, handoffAt: null }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.onCallDutyPolicyFeedEventType).toBe(
      OnCallDutyPolicyFeedEventType.CoverageGapStarted,
    );
    expect(rows[0]!.userId).toBeUndefined();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.workspaceNotification.updateKinds).toEqual([NobodyOnCall]);
    expect(sends[0]!.markdownByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `⚠️ Nobody is on call for [Payments](${POLICY_LINK}) until {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}, when @bob takes over.`,
    );
  });

  test("no workspace connected: the feed entry, and nothing asked of any workspace", async () => {
    connect([]);

    await OnCallHandoffPosts.post(handoff());

    expect(rows).toHaveLength(1);
    expect(sends).toHaveLength(0);
    expect(WorkspaceUtil.getUserStringForWorkspace).not.toHaveBeenCalled();
  });

  test("nothing to say: no entry and no message", async () => {
    await OnCallHandoffPosts.post(
      handoff({ previousUserId: ANA, previousNextUserId: BOB }),
    );

    expect(rows).toHaveLength(0);
    expect(sends).toHaveLength(0);
  });

  test("one message failing does not keep the others from their channels, and nothing is thrown", async () => {
    let calls: number = 0;

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
        calls++;

        if (calls === 1) {
          throw new Error("Slack is down");
        }

        sends.push(data);
      }) as never);

    await expect(OnCallHandoffPosts.post(handoff())).resolves.toBeUndefined();

    expect(calls).toBe(3);
    expect(sends).toHaveLength(2);
  });

  test("a failure before anything is posted is logged, not thrown: the roster is still saved", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockRejectedValue(new Error("no dashboard address"));

    await expect(OnCallHandoffPosts.post(handoff())).resolves.toBeUndefined();
    expect(rows).toHaveLength(0);
    expect(sends).toHaveLength(0);
  });
});

describe("a Mattermost post shows a moment as its time in UTC", () => {
  test("any message with a moment in it, not only a handoff", () => {
    expect(
      MattermostUtil.getMessageText(
        "Acknowledged at {{TIME(2026-11-14T22:50:00Z)}} by Ana.",
      ),
    ).toBe("Acknowledged at 22:50 UTC by Ana.");
  });

  test("text with no moment is posted as it was", () => {
    expect(MattermostUtil.getMessageText("Nothing {{to}} see.")).toBe(
      "Nothing {{to}} see.",
    );
  });
});

// The payloads the rule service posts carry what each workspace was given.
describe("a message with a line of its own for a workspace", () => {
  test("each workspace's blocks carry its own line; the others the message's", async () => {
    jest
      .spyOn(WorkspaceUtil, "getAllWorkspaceTypes")
      .mockReturnValue([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);

    const blocks: Array<{
      workspaceType: WorkspaceType;
      messageBlocks: Array<unknown>;
    }> = await WorkspaceUtil.getMessageBlocksByMarkdown({
      projectId: PROJECT_ID,
      userId: undefined,
      markdown: "📞 Ana is now on call.",
      markdownByWorkspaceType: {
        [WorkspaceType.Slack]: "📞 @ana is now on call.",
      },
    });

    expect(
      blocks.map((block: { messageBlocks: Array<unknown> }): string => {
        return (block.messageBlocks[0] as WorkspacePayloadMarkdown).text;
      }),
    ).toEqual(["📞 @ana is now on call.", "📞 Ana is now on call."]);
  });
});
