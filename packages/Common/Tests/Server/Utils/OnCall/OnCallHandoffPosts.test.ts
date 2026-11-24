import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "../../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  Service as WorkspaceNotificationRuleServiceClass,
} from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
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
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";
import BaseNotificationRule from "../../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
  WorkspacePayloadMention,
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

  test("a moment written for each reader's own zone: Slack's and Teams' own, and UTC in a Mattermost post that knows no zone", () => {
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
      /Nov 14, 2026, (17:50|5:50 PM) EST/,
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

  /*
   * MATTERMOST READS A HAND-OFF IN THE SCHEDULE'S ZONE, IN WORDS (#7970).
   *
   * Slack and Microsoft Teams show each moment in each reader's own zone.
   * Mattermost cannot, and its line read "until 2026-11-14 at 22:50 UTC":
   * a team in New York converted it in their heads at every hand-off. Its
   * line now says the moment as the policy's feed does, on the clock of the
   * zone the schedule's hand-offs are set in.
   */
  describe("Mattermost's line reads in the schedule's zone (#7970)", () => {
    beforeEach(() => {
      // Friday 13 November 2026: the hand-off is this year.
      jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockReturnValue(new Date("2026-11-13T12:00:00.000Z"));
      connect([
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
        WorkspaceType.Mattermost,
      ]);
    });

    function lineIn(workspaceType: WorkspaceType, index: number = 0): string {
      return sends[index]!.markdownByWorkspaceType?.[workspaceType] || "";
    }

    test("REGRESSION: a schedule in New York reads EST, in words - the issue's own line", async () => {
      await OnCallHandoffPosts.post(handoff());

      expect(lineIn(WorkspaceType.Mattermost)).toBe(
        `📞 @ana is now on call for [Payments](${POLICY_LINK}) until Sat, Nov 14 at 5:50 PM EST, then [Bob](https://oneuptime.test/users/bob).`,
      );

      // As Mattermost posts it: no UTC, no moment left to convert.
      const posted: string = MattermostUtil.getMessageText(
        lineIn(WorkspaceType.Mattermost),
      );

      expect(posted).toContain("until Sat, Nov 14 at 5:50 PM EST, then");
      expect(posted).not.toContain("UTC");
      expect(posted).not.toContain("2026-11-14");
      expect(posted).not.toContain("{{");
    });

    test("Slack and Microsoft Teams keep each reader's own zone", async () => {
      await OnCallHandoffPosts.post(handoff());

      for (const workspaceType of [
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
      ]) {
        expect(lineIn(workspaceType)).toContain(
          "until {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}, then",
        );
        expect(lineIn(workspaceType)).not.toContain("EST");
      }
    });

    test("a schedule set in no zone still reads in UTC - in words", async () => {
      await OnCallHandoffPosts.post(handoff({ scheduleTimezone: null }));

      expect(lineIn(WorkspaceType.Mattermost)).toContain(
        "until Sat, Nov 14 at 10:50 PM UTC, then",
      );
      // The feed, in the zone it always used for one: UTC.
      expect(rows[0]!.feedInfoInMarkdown).toMatch(/Nov 14, 2026, .*UTC/);
    });

    test("every line of the hand-off: who is next, and nobody on call, read in the zone too", async () => {
      await OnCallHandoffPosts.post(handoff());

      // Now on call then next, now on call, next on call.
      expect(sends).toHaveLength(3);
      expect(lineIn(WorkspaceType.Mattermost, 1)).toBe(
        `📞 @ana is now on call for [Payments](${POLICY_LINK}) until Sat, Nov 14 at 5:50 PM EST.`,
      );
      expect(lineIn(WorkspaceType.Mattermost, 2)).toBe(
        `➡️ [Bob](https://oneuptime.test/users/bob) is next on call for [Payments](${POLICY_LINK}), from Sat, Nov 14 at 5:50 PM EST.`,
      );

      sends = [];

      await OnCallHandoffPosts.post(
        handoff({ currentUserId: null, handoffAt: null }),
      );

      expect(lineIn(WorkspaceType.Mattermost)).toBe(
        `⚠️ Nobody is on call for [Payments](${POLICY_LINK}) until Sat, Nov 14 at 5:50 PM EST, when [Bob](https://oneuptime.test/users/bob) takes over.`,
      );
    });

    test("the line for a workspace with no line of its own keeps the moments every workspace converts", async () => {
      await OnCallHandoffPosts.post(handoff());

      expect(sends[0]!.feedInfoInMarkdown).toContain(
        "until {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}",
      );
    });

    test("only the on-call lines change: any other Mattermost post still reads a moment in UTC", () => {
      expect(
        MattermostUtil.getMessageText(
          "Acknowledged at {{TIME(2026-11-14T22:50:00Z)}} by Ana.",
        ),
      ).toBe("Acknowledged at 22:50 UTC by Ana.");
    });
  });

  /*
   * MENTION THE PERSON WHO COMES ON CALL (#7968).
   *
   * A line names the person on call as text that pings nobody. A rule can
   * ask for them to be mentioned instead: the lines that name who is on
   * call now are then said twice - with a real mention by the account Ana
   * connected in each workspace, for the channels whose rules ask for it,
   * and as before for every other - so no channel hears both. Who is next
   * is never mentioned; nor is anybody who connected no account.
   */
  describe("the person who comes on call, mentioned where a rule asks (#7968)", () => {
    const ANA_SLACK: string = "U0ANALEE";
    const ANA_ENTRA: string = "7a3e1d2c-4b5f-4c6d-8e9f-0a1b2c3d4e5f";
    const ANA_MATTERMOST: string = "anamattermostuserid00000000".slice(0, 26);

    /*
     * The accounts each person connected: Ana in every workspace, Bob in none.
     * Bob's accounts, for when he connected them too.
     */
    const BOB_SLACK: string = "U0BOBDIAZ";
    const BOB_ENTRA: string = "8b4f2e3d-5c6a-4d7e-9f0a-1b2c3d4e5f60";
    const BOB_MATTERMOST: string = "bobmattermostuserid0000000";

    function accounts(
      connected: Partial<Record<WorkspaceType, boolean>> = {
        [WorkspaceType.Slack]: true,
        [WorkspaceType.MicrosoftTeams]: true,
        [WorkspaceType.Mattermost]: true,
      },
      people: Array<ObjectID> = [ANA],
    ): void {
      jest
        .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
        .mockImplementation((async (data: {
          userId: ObjectID;
          workspaceType: WorkspaceType;
        }): Promise<WorkspaceUserAuthToken | null> => {
          const isAna: boolean = data.userId.toString() === ANA.toString();

          if (
            !people.some((person: ObjectID): boolean => {
              return person.toString() === data.userId.toString();
            }) ||
            !connected[data.workspaceType]
          ) {
            return null;
          }

          const token: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
          token.workspaceType = data.workspaceType;

          if (data.workspaceType === WorkspaceType.Slack) {
            token.workspaceUserId = isAna ? ANA_SLACK : BOB_SLACK;
          } else if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
            token.workspaceUserId = isAna ? ANA_ENTRA : BOB_ENTRA;
            token.miscData = {
              displayName: isAna ? "Ana Lee" : "Bob Diaz",
            } as never;
          } else {
            token.workspaceUserId = isAna ? ANA_MATTERMOST : BOB_MATTERMOST;
            token.miscData = { username: isAna ? "ana" : "bob" } as never;
          }

          return token;
        }) as never);
    }

    function sent(): Array<{
      updateKinds: unknown;
      mentioning: boolean | undefined;
      lines: Partial<Record<WorkspaceType, string>> | undefined;
      mentions: unknown;
    }> {
      return sends.map((send: (typeof sends)[number]) => {
        return {
          updateKinds: send.workspaceNotification.updateKinds,
          mentioning: send.workspaceNotification.mentioning,
          lines: send.markdownByWorkspaceType,
          mentions: send.mentionsByWorkspaceType,
        };
      });
    }

    beforeEach(() => {
      jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockReturnValue(new Date("2026-11-13T12:00:00.000Z"));
      jest
        .spyOn(UserService, "findOneById")
        .mockResolvedValue({ name: "Ana Lee" } as never);
      connect([
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
        WorkspaceType.Mattermost,
      ]);
    });

    test("REGRESSION: each line naming who is on call now is said twice - with the mention, and as before - each to its own channels", async () => {
      accounts();

      await OnCallHandoffPosts.post(handoff());

      expect(
        sent().map((send: ReturnType<typeof sent>[number]) => {
          return [send.updateKinds, send.mentioning];
        }),
      ).toEqual([
        // Now on call, then next: with the mention, and without.
        [[OnCallNow], true],
        [[OnCallNow], false],
        // Now on call alone: with the mention, and without.
        [[OnCallNow], true],
        [[OnCallNow], false],
        // Who is next, alone: never a mention, so said once.
        [[OnCallNext], undefined],
      ]);
    });

    test("in each workspace by the account Ana connected there; Bob, who is next, stays a name", async () => {
      accounts();

      await OnCallHandoffPosts.post(handoff());

      const mentioned: ReturnType<typeof sent>[number] = sent()[0]!;

      expect(mentioned.lines).toEqual({
        [WorkspaceType.Slack]: `📞 <@${ANA_SLACK}> is now on call for [Payments](${POLICY_LINK}) until {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}, then @bob.`,
        [WorkspaceType.MicrosoftTeams]: `📞 <at>Ana Lee</at> is now on call for [Payments](${POLICY_LINK}) until {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}, then @bob.`,
        [WorkspaceType.Mattermost]: `📞 @ana is now on call for [Payments](${POLICY_LINK}) until Sat, Nov 14 at 5:50 PM EST, then [Bob](https://oneuptime.test/users/bob).`,
      });
      expect(mentioned.mentions).toEqual({
        [WorkspaceType.Slack]: [
          {
            text: `<@${ANA_SLACK}>`,
            workspaceUserId: ANA_SLACK,
            name: "Ana Lee",
          },
        ],
        [WorkspaceType.MicrosoftTeams]: [
          {
            text: "<at>Ana Lee</at>",
            workspaceUserId: ANA_ENTRA,
            name: "Ana Lee",
          },
        ],
        [WorkspaceType.Mattermost]: [
          { text: "@ana", workspaceUserId: ANA_MATTERMOST, name: "ana" },
        ],
      });

      // The line without the mention is the line it always was.
      expect(sent()[1]!.lines?.[WorkspaceType.Slack]).toBe(
        `📞 @ana is now on call for [Payments](${POLICY_LINK}) until {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}, then @bob.`,
      );
      expect(sent()[1]!.mentions).toBeUndefined();
    });

    test("Mattermost posts Ana's mention whole, and breaks Bob's name as ever", async () => {
      accounts();

      await OnCallHandoffPosts.post(handoff());

      const post: JSONObject = MattermostUtil.toPost({
        blocks: MattermostUtil.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: [
            {
              _type: "WorkspacePayloadMarkdown",
              text: sent()[0]!.lines![WorkspaceType.Mattermost]!,
              mentions: (
                sent()[0]!.mentions as Partial<
                  Record<WorkspaceType, Array<WorkspacePayloadMention>>
                >
              )[WorkspaceType.Mattermost],
            } as WorkspacePayloadMarkdown,
          ],
        }),
        teamId: ANA_MATTERMOST,
      });

      expect(post["message"]).toContain("📞 @ana is now on call");
    });

    test("REGRESSION: who is next is never mentioned, even when they connected every account too", async () => {
      accounts(undefined, [ANA, BOB]);

      await OnCallHandoffPosts.post(handoff());

      // Now on call, then next: Ana mentioned, Bob named as ever.
      expect(sent()[0]!.lines?.[WorkspaceType.Slack]).toBe(
        `📞 <@${ANA_SLACK}> is now on call for [Payments](${POLICY_LINK}) until {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}}, then @bob.`,
      );

      for (const workspaceType of [
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
        WorkspaceType.Mattermost,
      ]) {
        const mentions: Array<WorkspacePayloadMention> =
          (
            sent()[0]!.mentions as Partial<
              Record<WorkspaceType, Array<WorkspacePayloadMention>>
            >
          )[workspaceType] || [];

        expect({
          workspaceType,
          mentioned: mentions.map((mention: WorkspacePayloadMention) => {
            return mention.workspaceUserId;
          }),
        }).toEqual({
          workspaceType,
          mentioned: [
            workspaceType === WorkspaceType.Slack
              ? ANA_SLACK
              : workspaceType === WorkspaceType.MicrosoftTeams
                ? ANA_ENTRA
                : ANA_MATTERMOST,
          ],
        });

        // No line holds Bob's mention.
        expect(sent()[0]!.lines?.[workspaceType]).not.toContain(BOB_SLACK);
        expect(sent()[0]!.lines?.[workspaceType]).not.toContain("<at>Bob");
      }

      // Who is next, alone: said once, nobody mentioned.
      expect(sent()[4]!.mentioning).toBeUndefined();
      expect(sent()[4]!.lines?.[WorkspaceType.Slack]).toContain(
        "➡️ @bob is next on call",
      );
    });

    test("a workspace where Ana connected nothing keeps her name in the mentioning line", async () => {
      accounts({ [WorkspaceType.Slack]: true });

      await OnCallHandoffPosts.post(handoff());

      expect(sent()[0]!.lines?.[WorkspaceType.Slack]).toContain(
        `📞 <@${ANA_SLACK}> is now on call`,
      );
      expect(sent()[0]!.lines?.[WorkspaceType.MicrosoftTeams]).toContain(
        "📞 @ana is now on call",
      );
      expect(
        Object.keys(sent()[0]!.mentions as Record<string, unknown>),
      ).toEqual([WorkspaceType.Slack]);
    });

    test("REGRESSION: nobody connected an account - nobody can be mentioned - one message each, exactly as before", async () => {
      accounts({});

      await OnCallHandoffPosts.post(handoff());

      expect(
        sent().map((send: ReturnType<typeof sent>[number]) => {
          return send.mentioning;
        }),
      ).toEqual([undefined, undefined, undefined]);
      expect(
        sent().every((send: ReturnType<typeof sent>[number]) => {
          return send.mentions === undefined;
        }),
      ).toBe(true);
    });

    test("nobody on call, and who is next alone, mention nobody", async () => {
      accounts();

      await OnCallHandoffPosts.post(
        handoff({ currentUserId: null, handoffAt: null }),
      );
      await OnCallHandoffPosts.post(
        handoff({ previousUserId: ANA, previousNextUserId: CARL }),
      );

      expect(
        sent().map((send: ReturnType<typeof sent>[number]) => {
          return [send.updateKinds, send.mentioning];
        }),
      ).toEqual([
        [[NobodyOnCall], undefined],
        [[OnCallNext], undefined],
      ]);
    });

    test("REGRESSION: the line with the mention failing, the channels that asked for it hear the line without it - not nothing", async () => {
      accounts();

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
          if (data.workspaceNotification.mentioning === true) {
            throw new Error("Slack refused the mention");
          }

          sends.push(data);
        }) as never);

      await expect(OnCallHandoffPosts.post(handoff())).resolves.toBeUndefined();

      /*
       * Each line without the mention goes wherever it is wanted: to the
       * channels that asked for the mention too, which would else hear
       * nothing of the hand-off.
       */
      expect(
        sent().map((send: ReturnType<typeof sent>[number]) => {
          return [send.updateKinds, send.mentioning];
        }),
      ).toEqual([
        [[OnCallNow], undefined],
        [[OnCallNow], undefined],
        [[OnCallNext], undefined],
      ]);
      expect(sent()[0]!.lines?.[WorkspaceType.Slack]).toContain(
        "📞 @ana is now on call",
      );
    });

    test("the line with the mention posted, the line without it skips the channels that heard the mention", async () => {
      accounts();

      await OnCallHandoffPosts.post(handoff());

      expect(sent()[1]!.mentioning).toBe(false);
      expect(sent()[3]!.mentioning).toBe(false);
    });
  });
});

/*
 * WHICH CHANNEL HEARS THE MENTION (#7968), through the real rule service: a
 * channel whose rule asks to mention the person who comes on call hears
 * the line with the mention; every other the line as before; a channel two
 * rules share hears the mention when either asks, and never both lines.
 */
describe("each channel hears the hand-off with the mention, or without it - never both", () => {
  function rule(
    channelNames: string,
    data: {
      updatesToPost?: Array<NotificationRuleUpdateKind>;
      mention?: boolean;
    } = {},
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
      ...(data.updatesToPost ? { updatesToPost: data.updatesToPost } : {}),
      ...(data.mention ? { shouldMentionWhoIsOnCall: true } : {}),
    } as BaseNotificationRule;
    return workspaceRule;
  }

  const RULES: Array<WorkspaceNotificationRule> = [
    // Saved before: every update, no mention.
    rule("legacy"),
    rule("pinged", { updatesToPost: [OnCallNow], mention: true }),
    rule("pinged-every-update", { mention: true }),
    rule("quiet", { updatesToPost: [OnCallNow] }),
    // Two rules, one channel: one asks for the mention.
    rule("shared", { updatesToPost: [OnCallNow] }),
    rule("shared", { updatesToPost: [OnCallNow, OnCallNext], mention: true }),
    // Asks for it, but posts only who is next: nothing to mention.
    rule("next-only", { updatesToPost: [OnCallNext], mention: true }),
  ];

  async function heard(
    mentioning: boolean | undefined,
  ): Promise<Array<string>> {
    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue(RULES);
    jest
      .spyOn(
        WorkspaceNotificationRuleService as never,
        "getWorkspaceChannelsByNotificationFor",
      )
      .mockResolvedValue([] as never);

    const destinations: Array<WorkspaceMessagePayload> =
      await WorkspaceNotificationRuleService.getMessageDestinationsWanting({
        projectId: PROJECT_ID,
        notificationFor: { onCallDutyPolicyId: POLICY_ID },
        workspaceType: WorkspaceType.Slack,
        updateKinds: [OnCallNow],
        mentioning: mentioning,
      });

    return destinations
      .flatMap((destination: WorkspaceMessagePayload): Array<string> => {
        return destination.channelNames;
      })
      .sort();
  }

  test("REGRESSION: the mention where a rule asks for it, the line as before everywhere else", async () => {
    expect(await heard(true)).toEqual([
      "pinged",
      "pinged-every-update",
      "shared",
    ]);
    expect(await heard(false)).toEqual(["legacy", "quiet"]);
  });

  test("the two add up to every channel that wants the line, none twice", async () => {
    const everywhere: Array<string> = await heard(undefined);
    const both: Array<string> = [
      ...(await heard(true)),
      ...(await heard(false)),
    ].sort();

    expect(both).toEqual(everywhere);
    expect(new Set<string>(both).size).toBe(both.length);
  });

  test("a channel created for the policy, with rules that ask for it or not", async () => {
    const asks: WorkspaceNotificationRule = RULES[1]!;
    const quiet: WorkspaceNotificationRule = RULES[3]!;

    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue([]);
    jest
      .spyOn(WorkspaceNotificationRuleService as never, "getNotificationRules")
      .mockResolvedValue([asks, quiet] as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService as never,
        "getWorkspaceChannelsByNotificationFor",
      )
      .mockResolvedValue([
        {
          id: "C1",
          name: "policy-pinged",
          workspaceType: WorkspaceType.Slack,
          notificationRuleIds: [asks.id!.toString()],
        },
        {
          id: "C2",
          name: "policy-quiet",
          workspaceType: WorkspaceType.Slack,
          notificationRuleIds: [quiet.id!.toString()],
        },
        // Stored before its rules were recorded: hears it as before.
        { id: "C3", name: "policy-old", workspaceType: WorkspaceType.Slack },
      ] as never);

    const channelIds: (mentioning: boolean) => Promise<Array<string>> = async (
      mentioning: boolean,
    ): Promise<Array<string>> => {
      return (
        await WorkspaceNotificationRuleService.getMessageDestinationsWanting({
          projectId: PROJECT_ID,
          notificationFor: { onCallDutyPolicyId: POLICY_ID },
          workspaceType: WorkspaceType.Slack,
          updateKinds: [OnCallNow],
          mentioning: mentioning,
        })
      ).flatMap((destination: WorkspaceMessagePayload): Array<string> => {
        return destination.channelIds;
      });
    };

    expect(await channelIds(true)).toEqual(["C1"]);
    expect((await channelIds(false)).sort()).toEqual(["C2", "C3"]);
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

  test("a workspace's own line carries the people it mentions; the shared line mentions nobody (#7968)", async () => {
    jest
      .spyOn(WorkspaceUtil, "getAllWorkspaceTypes")
      .mockReturnValue([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);

    const slackMention: WorkspacePayloadMention = {
      text: "<@U0ANALEE>",
      workspaceUserId: "U0ANALEE",
      name: "Ana Lee",
    };

    const blocks: Array<{
      workspaceType: WorkspaceType;
      messageBlocks: Array<unknown>;
    }> = await WorkspaceUtil.getMessageBlocksByMarkdown({
      projectId: PROJECT_ID,
      userId: undefined,
      markdown: "📞 Ana is now on call.",
      markdownByWorkspaceType: {
        [WorkspaceType.Slack]: "📞 <@U0ANALEE> is now on call.",
      },
      mentionsByWorkspaceType: {
        [WorkspaceType.Slack]: [slackMention],
        // No line of its own: whatever it was handed, it mentions nobody.
        [WorkspaceType.MicrosoftTeams]: [
          {
            text: "<at>Ana Lee</at>",
            workspaceUserId: "7a3e1d2c-4b5f-4c6d-8e9f-0a1b2c3d4e5f",
            name: "Ana Lee",
          },
        ],
      },
    });

    expect(
      blocks.map(
        (block: {
          messageBlocks: Array<unknown>;
        }): Array<WorkspacePayloadMention> | undefined => {
          return (block.messageBlocks[0] as WorkspacePayloadMarkdown).mentions;
        },
      ),
    ).toEqual([[slackMention], undefined]);
  });

  test("a notification log names a mention by the name it shows, not the workspace's id (#7968)", async () => {
    const logs: Array<{ message?: string | undefined }> = [];

    jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockImplementation((async (data: {
        data: { message?: string | undefined };
      }) => {
        logs.push(data.data);
        return data.data;
      }) as never);

    await WorkspaceNotificationRuleService.logSendResponses({
      projectId: PROJECT_ID,
      notificationFor: { onCallDutyPolicyId: POLICY_ID },
      responses: [
        {
          workspaceType: WorkspaceType.Slack,
          threads: [
            {
              channel: {
                id: "C1",
                name: "on-call",
                workspaceType: WorkspaceType.Slack,
              },
              threadId: "1.2",
            },
          ],
        },
      ],
      messageBlocksByWorkspaceTypes: [
        {
          workspaceType: WorkspaceType.Slack,
          messageBlocks: [
            {
              _type: "WorkspacePayloadMarkdown",
              text: "📞 <@U0ANALEE> is now on call until {{TIME(2026-11-14T22:50:00Z)}}.",
              mentions: [
                {
                  text: "<@U0ANALEE>",
                  workspaceUserId: "U0ANALEE",
                  name: "Ana Lee",
                },
              ],
            } as WorkspacePayloadMarkdown,
          ],
        },
      ],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.message).toBe(
      "📞 @Ana Lee is now on call until 22:50 UTC.",
    );
  });
});
