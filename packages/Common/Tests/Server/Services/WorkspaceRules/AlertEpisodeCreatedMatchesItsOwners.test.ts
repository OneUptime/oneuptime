import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import CreatedRecordWorld, {
  DATABASE_LABEL,
  EXISTING_CHANNEL,
  FeedRow,
  PLATFORM_MEMBER_SLACK_ID,
  PLATFORM_TEAM,
} from "./CreatedRecordWorld";
import { makeRule, OTHER_RULE_ID, OWNER } from "./WorkspaceRuleWorld";
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
 * A NOTIFICATION RULE THAT ASKS WHO OWNS AN ALERT EPISODE, OR HOW IT IS
 * LABELLED, POSTS "EPISODE CREATED" (#11188).
 *
 * A Slack rule for alert episodes - "Alert Episode Owner is any of
 * Platform", posting to the existing channel #platform-alerts - never
 * posted "Episode AE-4 Created": the episode's create chain opened its
 * channels and posted its created message before it added the owners
 * picked on its form, its owner rules' owners and its label rules' labels,
 * so the rule did not match yet. A grouping rule's Episode Owners, added
 * once the episode's create has returned, missed it too. The channel heard
 * of the episode only from "Added team Platform to the Episode as the
 * owner".
 *
 * Now the chain adds them first, waits a moment for the grouping rule's,
 * and only then opens channels and posts "Episode Created"; what was
 * posted about the episode meanwhile follows it, and its pages come after.
 * Driven through the real AlertEpisodeService create chain, rule matching,
 * channel creation, invites and messages against a fake Slack
 * (CreatedRecordWorld).
 */

let world: CreatedRecordWorld;

beforeEach(() => {
  world = new CreatedRecordWorld();
  world.install();
  world.addSlackChannel(EXISTING_CHANNEL);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function ownedBy(
  ids: Array<ObjectID>,
  conditionType: ConditionType = ConditionType.ContainsAny,
): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.AlertEpisodeOwners,
    conditionType: conditionType,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

function labelled(ids: Array<ObjectID>): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.AlertEpisodeLabels,
    conditionType: ConditionType.ContainsAny,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

// A rule that posts the alert episodes it matches to #platform-alerts.
function postsToExistingChannel(
  filters: Array<NotificationRuleCondition>,
): void {
  world.rules = [
    makeRule({
      name: "Platform's episodes",
      eventType: NotificationRuleEventType.AlertEpisode,
      filters: filters,
      createsChannel: false,
      existingChannels: EXISTING_CHANNEL.name,
    }),
  ];
}

// What #platform-alerts was told, in order.
function existingChannelPosts(): Array<string> {
  return world.postsIn(EXISTING_CHANNEL.id);
}

function isCreated(post: string): boolean {
  return post.includes("Episode AE-4 Created");
}

function isPlatformAdded(post: string): boolean {
  return post.includes("Added team") && post.includes("Platform");
}

// The entry naming the alerts the episode was created with.
function isAlertAdded(post: string): boolean {
  return post.includes("ALT-6");
}

describe("Alert Episode Owner is any of Platform, posting to an existing channel", () => {
  beforeEach(() => {
    postsToExistingChannel([ownedBy([PLATFORM_TEAM])]);
  });

  test.each([
    [
      "picked on the Create Alert Episode form (or the API)",
      { ownersPicked: { teams: [PLATFORM_TEAM] } },
    ],
    ["added by an owner rule", { ownerRules: true }],
    [
      "a grouping rule's Episode Owners, added once the create has returned",
      { callerAdds: { teams: [PLATFORM_TEAM] } },
    ],
  ])(
    "REGRESSION: the channel gets Episode Created, then the owner, when Platform is %s",
    async (
      _how: string,
      setUp: {
        ownersPicked?: { teams: Array<ObjectID> };
        ownerRules?: boolean;
        callerAdds?: { teams: Array<ObjectID> };
      },
    ) => {
      if (setUp.ownerRules) {
        world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };
      }

      await world.createAlertEpisode({
        ownersPicked: setUp.ownersPicked,
        callerAdds: setUp.callerAdds,
      });

      const posts: Array<string> = existingChannelPosts();

      expect(posts).toHaveLength(2);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(isPlatformAdded(posts[1]!)).toBe(true);
    },
  );

  test("Episode Created is posted there once, whatever adds Platform, however many times", async () => {
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createAlertEpisode({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      callerAdds: { teams: [PLATFORM_TEAM] },
    });

    const posts: Array<string> = existingChannelPosts();

    expect(posts.filter(isCreated)).toHaveLength(1);
    // Platform was added once: the rule and the grouping rule found it there already.
    expect(posts.filter(isPlatformAdded)).toHaveLength(1);
  });

  test("an episode Platform does not own posts nothing there", async () => {
    await world.createAlertEpisode({ ownersPicked: { users: [OWNER] } });

    expect(existingChannelPosts()).toEqual([]);
  });

  test("Episode Created comes before the episode's pages", async () => {
    await world.createAlertEpisode({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    const lastPost: number = world.events.lastIndexOf("slack:chat.postMessage");

    expect(world.events).toContain("paging");
    expect(world.events.indexOf("paging")).toBeGreaterThan(lastPost);
  });
});

describe("Alert Episode Owner is none of Platform", () => {
  /*
   * The other side of the same gap: matched before its owners were in, an
   * episode Platform owns matched "is none of Platform", and its Episode
   * Created went to a channel that does not want Platform's episodes.
   */
  test("REGRESSION: an episode Platform owns from its create posts nothing there", async () => {
    postsToExistingChannel([
      ownedBy([PLATFORM_TEAM], ConditionType.NotContains),
    ]);

    await world.createAlertEpisode({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    expect(existingChannelPosts().filter(isCreated)).toEqual([]);
  });

  test("an episode somebody else owns is posted there", async () => {
    postsToExistingChannel([
      ownedBy([PLATFORM_TEAM], ConditionType.NotContains),
    ]);

    await world.createAlertEpisode({ ownersPicked: { users: [OWNER] } });

    expect(existingChannelPosts().filter(isCreated)).toHaveLength(1);
  });
});

describe("Alert Episode Labels is any of database", () => {
  beforeEach(() => {
    postsToExistingChannel([labelled([DATABASE_LABEL])]);
  });

  test("REGRESSION: the channel gets Episode Created when a label rule attaches the label", async () => {
    world.labelRulesAttach = [DATABASE_LABEL];

    await world.createAlertEpisode();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(1);
    expect(isCreated(posts[0]!)).toBe(true);
  });

  test("an episode without the label posts nothing there", async () => {
    await world.createAlertEpisode();

    expect(existingChannelPosts()).toEqual([]);
  });
});

describe("a rule that opens a channel for Platform's alert episodes", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Platform's episode channels",
        eventType: NotificationRuleEventType.AlertEpisode,
        filters: [ownedBy([PLATFORM_TEAM])],
        inviteOwners: true,
      }),
    ];
  });

  test("REGRESSION: opens it as the episode is created, with Episode Created as its first message and Platform in it", async () => {
    await world.createAlertEpisode({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    expect(world.slackChannelsCreated()).toHaveLength(1);

    const posts: Array<string> = world.postsIn("C0NEW2");

    // Its first message announces the episode - not a channel opened later for it.
    expect(posts.length).toBeGreaterThan(0);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(
      posts.some((post: string): boolean => {
        return post.includes("This channel is for");
      }),
    ).toBe(false);
    expect(posts.filter(isCreated)).toHaveLength(1);

    // Platform's member joined the channel as it was set up.
    expect(world.slackUsersInvitedTo("C0NEW2")).toContain(
      PLATFORM_MEMBER_SLACK_ID,
    );
  });
});

describe("every other rule hears of the alert episode as before", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Every episode",
        eventType: NotificationRuleEventType.AlertEpisode,
        createsChannel: false,
        existingChannels: EXISTING_CHANNEL.name,
      }),
      makeRule({
        id: OTHER_RULE_ID,
        name: "A channel for every episode",
        eventType: NotificationRuleEventType.AlertEpisode,
      }),
    ];
  });

  test("Episode Created first, then its owners - each message once, in each channel", async () => {
    await world.createAlertEpisode({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    for (const channelId of [EXISTING_CHANNEL.id, "C0NEW2"]) {
      const posts: Array<string> = world.postsIn(channelId);

      expect(posts).toHaveLength(2);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(isPlatformAdded(posts[1]!)).toBe(true);
    }
  });

  test("an episode created with alerts: they follow Episode Created, ahead of its owners", async () => {
    await world.createAlertEpisode({
      withMembers: true,
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(3);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(isAlertAdded(posts[1]!)).toBe(true);
    expect(isPlatformAdded(posts[2]!)).toBe(true);
  });

  test("an episode with no owners: Episode Created alone", async () => {
    await world.createAlertEpisode();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(1);
    expect(isCreated(posts[0]!)).toBe(true);
  });
});

describe("the alert episode's feed", () => {
  test("REGRESSION: starts with Episode Created, then its first state, then the alerts it was created with, then its owners", async () => {
    world.rules = [];

    await world.createAlertEpisode({
      withMembers: true,
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    const feed: Array<FeedRow> = world.feedInOrder(
      world.records.alertEpisode.feedRows,
    );

    expect(
      feed.map((row: FeedRow): string => {
        return row.type;
      }),
    ).toEqual([
      "EpisodeCreated",
      "EpisodeStateChanged",
      "AlertAdded",
      "OwnerTeamAdded",
    ]);
  });
});
