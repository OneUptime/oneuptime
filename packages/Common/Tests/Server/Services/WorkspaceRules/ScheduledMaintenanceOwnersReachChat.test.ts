import UserService from "../../../../Server/Services/UserService";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { NotificationRuleUpdateKind } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import CreatedRecordWorld, {
  EXISTING_CHANNEL,
  FeedRow,
  PLATFORM_MEMBER_SLACK_ID,
  PLATFORM_TEAM,
} from "./CreatedRecordWorld";
import {
  makeRule,
  OTHER_RULE_ID,
  OWNER,
  RULE_USER,
  SCHEDULED_MAINTENANCE_LINK,
} from "./WorkspaceRuleWorld";
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
 * A SCHEDULED MAINTENANCE EVENT'S OWNER CHANGES REACH SLACK AND MICROSOFT
 * TEAMS, AS EVERY OTHER KIND OF RECORD'S DO (#11223).
 *
 * Adding an owner to a maintenance event wrote "Added team Platform to the
 * scheduled maintenance as the owner" to its feed and nothing to its
 * channels, and so did taking one off: its owner services passed no
 * workspace notification. An incident's, an alert's, an episode's, a
 * monitor's and an on-call policy's owner changes are posted to their
 * channels. So a maintenance event's channel never heard who owns it, and
 * the owners its create adds - picked on its form, added by its owner
 * rules, its creator - were in its feed alone.
 *
 * Now each is posted, through the same path as the other kinds': its feed
 * entry's workspace notification. While the event is being created each
 * waits for "Scheduled Maintenance Created" and follows it, in the order
 * it was made, once (WorkspaceCreatedMessageFirst). Later, each is posted
 * as it is made, and a rule it makes match opens its channel first
 * (createChannelsForRulesThatNowMatch, which posting asks). A rule that
 * chooses its updates posts them when it ticks Owners.
 *
 * Driven through the real ScheduledMaintenanceService create chain, the
 * real owner services' hooks, rule matching, channel creation, invites and
 * messages against a fake Slack (CreatedRecordWorld).
 */

// The channel a rule creates for the event: the second Slack has.
const NEW_CHANNEL: string = "C0NEW2";

// Each person by the name their owner lines give them.
const NAMES: Record<string, string> = {
  [OWNER.toString()]: "Ana Lee",
  [RULE_USER.toString()]: "Ravi Shah",
};

let world: CreatedRecordWorld;

beforeEach(() => {
  world = new CreatedRecordWorld();
  world.install();
  world.addSlackChannel(EXISTING_CHANNEL);

  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation((async (data: {
      userId: ObjectID;
    }): Promise<MarkdownText> => {
      return mdText`${NAMES[data.userId.toString()] || "Somebody"}`;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function ownedBy(
  ids: Array<ObjectID>,
  conditionType: ConditionType = ConditionType.ContainsAny,
): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.ScheduledMaintenanceOwners,
    conditionType: conditionType,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

// One rule: every maintenance event, or those its filters match, posted to #platform-alerts.
function postsToExistingChannel(
  options: {
    filters?: Array<NotificationRuleCondition>;
    updatesToPost?: Array<NotificationRuleUpdateKind>;
  } = {},
): void {
  world.rules = [
    makeRule({
      name: "Maintenance in #platform-alerts",
      eventType: NotificationRuleEventType.ScheduledMaintenance,
      filters: options.filters || [],
      createsChannel: false,
      existingChannels: EXISTING_CHANNEL.name,
      updatesToPost: options.updatesToPost,
    }),
  ];
}

function existingChannelPosts(): Array<string> {
  return world.postsIn(EXISTING_CHANNEL.id);
}

/*
 * What a post is, from its text: the event's Created message, an owner
 * added or removed - named by who it is - or the first line of a channel a
 * rule opened later.
 */
function describePost(post: string): string {
  if (post.includes("Scheduled Maintenance SM-5 Created")) {
    return "Created";
  }

  const isAboutTheEvent: boolean = post.includes("Scheduled Maintenance SM-5");

  for (const [verb, word] of [
    ["Added", "added"],
    ["Removed", "removed"],
  ] as Array<[string, string]>) {
    if (!post.includes(verb) || !post.includes("as the owner")) {
      continue;
    }

    const who: string = post.includes(`${verb} team`)
      ? "Platform"
      : Object.values(NAMES).find((name: string): boolean => {
          return post.includes(name);
        }) || "Somebody";

    return `${who} ${word}${isAboutTheEvent ? "" : " (of no event)"}`;
  }

  return post.slice(0, 60);
}

function said(channelId: string): Array<string> {
  return world.postsIn(channelId).map(describePost);
}

describe("the owners an event is created with follow Scheduled Maintenance Created in its channels", () => {
  beforeEach(() => {
    postsToExistingChannel();
  });

  test("REGRESSION (#11223): an owner picked on the create form", async () => {
    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created", "Platform added"]);
  });

  test("REGRESSION (#11223): an owner an owner rule adds", async () => {
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createScheduledMaintenance();

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created", "Platform added"]);
  });

  test("REGRESSION (#11223): its creator, made its owner as the create returns", async () => {
    await world.createScheduledMaintenance({ creator: OWNER });

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created", "Ana Lee added"]);
  });

  test("REGRESSION (#11223): picked, added by a rule and its creator: Created first, then each in the order it was added, each once", async () => {
    world.ownerRulesAdd = { users: [RULE_USER], teams: [PLATFORM_TEAM] };

    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      creator: OWNER,
    });

    // Platform was picked, so the rule found it there already.
    expect(said(EXISTING_CHANNEL.id)).toEqual([
      "Created",
      "Platform added",
      "Ravi Shah added",
      "Ana Lee added",
    ]);
  });

  test("REGRESSION (#11223): a recurring event's template owners, copied on once its create returns, follow Created, and a rule naming them matches it", async () => {
    world.rules = [
      makeRule({
        name: "Platform's maintenance",
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        filters: [ownedBy([PLATFORM_TEAM])],
        createsChannel: false,
        existingChannels: EXISTING_CHANNEL.name,
      }),
    ];

    // ScheduleRecurringEvents says the template's owners come right after the create.
    await world.createScheduledMaintenance({
      callerAdds: { teams: [PLATFORM_TEAM], users: [OWNER] },
    });

    expect(said(EXISTING_CHANNEL.id)).toEqual([
      "Created",
      "Ana Lee added",
      "Platform added",
    ]);
  });

  test("an event created with no owners: Scheduled Maintenance Created alone", async () => {
    await world.createScheduledMaintenance();

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created"]);
  });

  test("the owner line names the event, linked to its page, and the owner", async () => {
    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(2);
    expect(posts[1]).toContain("Platform");
    expect(posts[1]).toContain("Scheduled Maintenance SM-5");
    expect(posts[1]).toContain(SCHEDULED_MAINTENANCE_LINK.toString());
  });
});

describe("a channel a rule opens for the event", () => {
  test("REGRESSION (#11223): opens on Scheduled Maintenance Created, then hears the owners, each once", async () => {
    world.rules = [
      makeRule({
        name: "A channel for every event",
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        inviteOwners: true,
      }),
    ];
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createScheduledMaintenance({ creator: OWNER });

    expect(world.slackChannelsCreated()).toHaveLength(1);
    expect(said(NEW_CHANNEL)).toEqual([
      "Created",
      "Platform added",
      "Ana Lee added",
    ]);

    // Its owners were invited as the channel was set up, or as they were added.
    expect(world.slackUsersInvitedTo(NEW_CHANNEL)).toContain(
      PLATFORM_MEMBER_SLACK_ID,
    );
  });

  test("REGRESSION (#11223): the event's own channel and an existing one each hear every message once, in the same order", async () => {
    world.rules = [
      makeRule({
        name: "Every event in #platform-alerts",
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        createsChannel: false,
        existingChannels: EXISTING_CHANNEL.name,
      }),
      makeRule({
        id: OTHER_RULE_ID,
        name: "A channel for every event",
        eventType: NotificationRuleEventType.ScheduledMaintenance,
      }),
    ];

    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      creator: OWNER,
    });

    for (const channelId of [EXISTING_CHANNEL.id, NEW_CHANNEL]) {
      expect({ channelId, said: said(channelId) }).toEqual({
        channelId,
        said: ["Created", "Platform added", "Ana Lee added"],
      });
    }
  });
});

describe("an owner added or taken off later", () => {
  beforeEach(() => {
    postsToExistingChannel();
  });

  test("REGRESSION (#11223): a team added later is posted as it is added", async () => {
    await world.createScheduledMaintenance();

    await world.addOwnersOf("scheduledMaintenance", { teams: [PLATFORM_TEAM] });
    await world.settle();

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created", "Platform added"]);
  });

  test("REGRESSION (#11223): a person added later is posted as they are added", async () => {
    await world.createScheduledMaintenance();

    await world.addOwnersOf("scheduledMaintenance", { users: [OWNER] });
    await world.settle();

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created", "Ana Lee added"]);
  });

  test("REGRESSION (#11223): a team taken off is posted", async () => {
    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    await world.removeOwnersOf("scheduledMaintenance", {
      teams: [PLATFORM_TEAM],
    });

    expect(said(EXISTING_CHANNEL.id)).toEqual([
      "Created",
      "Platform added",
      "Platform removed",
    ]);
  });

  test("REGRESSION (#11223): a person taken off is posted", async () => {
    await world.createScheduledMaintenance({ creator: OWNER });

    await world.removeOwnersOf("scheduledMaintenance", { users: [OWNER] });

    expect(said(EXISTING_CHANNEL.id)).toEqual([
      "Created",
      "Ana Lee added",
      "Ana Lee removed",
    ]);
  });

  test("REGRESSION (#11223): the event's own channel hears an owner added later, once", async () => {
    world.rules = [
      makeRule({
        name: "A channel for every event",
        eventType: NotificationRuleEventType.ScheduledMaintenance,
      }),
    ];

    await world.createScheduledMaintenance();
    await world.addOwnersOf("scheduledMaintenance", { teams: [PLATFORM_TEAM] });
    await world.settle();

    expect(said(NEW_CHANNEL)).toEqual(["Created", "Platform added"]);
  });

  test("the removal of an owner nobody had is posted nowhere: nothing was taken off", async () => {
    await world.createScheduledMaintenance();

    await world.removeOwnersOf("scheduledMaintenance", {
      teams: [PLATFORM_TEAM],
    });

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created"]);
  });
});

describe("a rule an owner change makes match", () => {
  test("REGRESSION (#11223): Scheduled Maintenance Owner is any of Platform, creating channels: Platform added later opens its channel, which hears that Platform was added", async () => {
    world.rules = [
      makeRule({
        name: "Platform's maintenance channels",
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        filters: [ownedBy([PLATFORM_TEAM])],
        inviteOwners: true,
      }),
    ];

    await world.createScheduledMaintenance();

    // Nobody owned it: the rule did not match, and opened nothing.
    expect(world.slackChannelsCreated()).toEqual([]);

    await world.addOwnersOf("scheduledMaintenance", { teams: [PLATFORM_TEAM] });
    await world.settle();

    expect(world.slackChannelsCreated()).toHaveLength(1);

    const heard: Array<string> = said(NEW_CHANNEL);

    expect(
      heard.filter((post: string): boolean => {
        return post === "Platform added";
      }),
    ).toHaveLength(1);
    expect(heard[heard.length - 1]).toBe("Platform added");
    expect(world.slackUsersInvitedTo(NEW_CHANNEL)).toContain(
      PLATFORM_MEMBER_SLACK_ID,
    );
  });

  test("REGRESSION (#11223): Scheduled Maintenance Owner is none of Platform, in an existing channel: Platform taken off is posted there", async () => {
    postsToExistingChannel({
      filters: [ownedBy([PLATFORM_TEAM], ConditionType.NotContains)],
    });

    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    // Platform's event: the rule did not match it.
    expect(said(EXISTING_CHANNEL.id)).toEqual([]);

    await world.removeOwnersOf("scheduledMaintenance", {
      teams: [PLATFORM_TEAM],
    });

    // From then on it does.
    expect(said(EXISTING_CHANNEL.id)).toEqual(["Platform removed"]);
  });

  test("Scheduled Maintenance Owner is any of Platform: an owner who is not Platform is posted nowhere, and the rule opens nothing", async () => {
    world.rules = [
      makeRule({
        name: "Platform's maintenance channels",
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        filters: [ownedBy([PLATFORM_TEAM])],
      }),
    ];

    await world.createScheduledMaintenance();
    await world.addOwnersOf("scheduledMaintenance", { users: [OWNER] });
    await world.settle();

    expect(world.slackChannelsCreated()).toEqual([]);
    expect(world.slackMethods()).not.toContain("chat.postMessage");
  });
});

describe("a rule that chooses which updates it posts", () => {
  test("Key updates only: the owners are not posted, Scheduled Maintenance Created is", async () => {
    postsToExistingChannel({
      updatesToPost: [
        NotificationRuleUpdateKind.StateChanges,
        NotificationRuleUpdateKind.PublicNotes,
      ],
    });

    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      creator: OWNER,
    });
    await world.addOwnersOf("scheduledMaintenance", { users: [RULE_USER] });
    await world.settle();

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created"]);
  });

  test("REGRESSION (#11223): Owners ticked: the owners are posted", async () => {
    postsToExistingChannel({
      updatesToPost: [NotificationRuleUpdateKind.Owners],
    });

    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      creator: OWNER,
    });
    await world.removeOwnersOf("scheduledMaintenance", {
      teams: [PLATFORM_TEAM],
    });

    expect(said(EXISTING_CHANNEL.id)).toEqual([
      "Created",
      "Platform added",
      "Ana Lee added",
      "Platform removed",
    ]);
  });

  test("Everything else ticked, Owners not: the owners are their own box, so they are not posted", async () => {
    postsToExistingChannel({
      updatesToPost: [
        NotificationRuleUpdateKind.StateChanges,
        NotificationRuleUpdateKind.PublicNotes,
        NotificationRuleUpdateKind.PrivateNotes,
        NotificationRuleUpdateKind.Reminders,
        NotificationRuleUpdateKind.Other,
      ],
    });

    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      creator: OWNER,
    });

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created"]);
  });
});

describe("the event's feed", () => {
  test("still starts with Scheduled Maintenance Created, then its first state, then its owners, and each owner line names the event", async () => {
    world.rules = [];

    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      creator: OWNER,
    });

    const feed: Array<FeedRow> = world.feedInOrder(
      world.records.scheduledMaintenance.feedRows,
    );

    expect(
      feed.map((row: FeedRow): string => {
        return row.type;
      }),
    ).toEqual([
      "ScheduledMaintenanceCreated",
      "ScheduledMaintenanceStateChanged",
      "OwnerTeamAdded",
      "OwnerUserAdded",
    ]);

    for (const row of feed.slice(2)) {
      expect(row.markdown).toContain(
        `[Scheduled Maintenance SM-5](${SCHEDULED_MAINTENANCE_LINK.toString()})`,
      );
    }
  });

  test("an owner taken off is written to the feed, naming the event", async () => {
    world.rules = [];

    await world.createScheduledMaintenance({ creator: OWNER });
    await world.removeOwnersOf("scheduledMaintenance", { users: [OWNER] });

    const removed: Array<FeedRow> =
      world.records.scheduledMaintenance.feedRows.filter(
        (row: FeedRow): boolean => {
          return row.type === "OwnerUserRemoved";
        },
      );

    expect(removed).toHaveLength(1);
    expect(removed[0]!.markdown).toContain("Removed **Ana Lee** from the");
    expect(removed[0]!.markdown).toContain(
      `[Scheduled Maintenance SM-5](${SCHEDULED_MAINTENANCE_LINK.toString()})`,
    );
  });
});
