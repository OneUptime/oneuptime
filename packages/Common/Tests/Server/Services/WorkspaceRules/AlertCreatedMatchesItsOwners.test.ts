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
 * A NOTIFICATION RULE THAT ASKS WHO OWNS AN ALERT, OR HOW IT IS LABELLED,
 * POSTS "ALERT CREATED" (#11146).
 *
 * A Slack rule for alerts - "Alert Owner is any of Platform", posting to the
 * existing channel #platform-alerts - never posted "Alert Created": the
 * alert's create chain opened its channels and posted "Alert Created" before
 * it added the owners picked on its form, its owner rules' owners and its
 * label rules' labels, so the rule did not match yet. The channel heard of
 * the alert only from a later update - "Added team Platform to the Alert as
 * the owner". An alert gets its owners from its form, a workflow's Create
 * One Alert step or the API (handed over with the create), its owner rules,
 * its creator, and the monitor whose criteria name them.
 *
 * Now the chain adds them first, waits a moment for the creator's and the
 * monitor's, and only then opens channels and posts "Alert Created"; what
 * was posted about the alert meanwhile follows it. Driven through the real
 * AlertService create chain, rule matching, channel creation, invites and
 * messages against a fake Slack (CreatedRecordWorld).
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
    checkOn: NotificationRuleConditionCheckOn.AlertOwners,
    conditionType: conditionType,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

function labelled(ids: Array<ObjectID>): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.AlertLabels,
    conditionType: ConditionType.ContainsAny,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

// A rule that posts the alerts it matches to #platform-alerts.
function postsToExistingChannel(
  filters: Array<NotificationRuleCondition>,
): void {
  world.rules = [
    makeRule({
      name: "Platform's alerts",
      eventType: NotificationRuleEventType.Alert,
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
  return post.includes("Alert ALT-7 Created");
}

function isPlatformAdded(post: string): boolean {
  return post.includes("Added team") && post.includes("Platform");
}

describe("Alert Owner is any of Platform, posting to an existing channel", () => {
  beforeEach(() => {
    postsToExistingChannel([ownedBy([PLATFORM_TEAM])]);
  });

  test.each([
    [
      "picked on the alert form (or a workflow's Create One Alert step, or the API)",
      { ownersPicked: { teams: [PLATFORM_TEAM] } },
    ],
    ["added by an owner rule", { ownerRules: true }],
    [
      "named by the monitor's criteria, added once the create has returned",
      { callerAdds: { teams: [PLATFORM_TEAM] } },
    ],
  ])(
    "REGRESSION: the channel gets Alert Created, then the owner, when Platform is %s",
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

      await world.createAlert({
        ownersPicked: setUp.ownersPicked,
        callerAdds: setUp.callerAdds,
      });

      const posts: Array<string> = existingChannelPosts();

      expect(posts).toHaveLength(2);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(isPlatformAdded(posts[1]!)).toBe(true);
    },
  );

  test("REGRESSION: an alert its creator owns, under a rule naming them: the creator is waited for", async () => {
    postsToExistingChannel([ownedBy([OWNER])]);

    await world.createAlert({ creator: OWNER });

    const posts: Array<string> = existingChannelPosts();

    expect(posts.length).toBeGreaterThan(0);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(posts.filter(isCreated)).toHaveLength(1);
  });

  test("Alert Created is posted there once, whatever adds Platform, however many times", async () => {
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createAlert({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      callerAdds: { teams: [PLATFORM_TEAM] },
    });

    const posts: Array<string> = existingChannelPosts();

    expect(posts.filter(isCreated)).toHaveLength(1);
    // Platform was added once: the rule and the monitor found it there already.
    expect(posts.filter(isPlatformAdded)).toHaveLength(1);
  });

  test("an alert Platform does not own posts nothing there", async () => {
    await world.createAlert({ ownersPicked: { users: [OWNER] } });

    expect(existingChannelPosts()).toEqual([]);
  });

  test("Alert Created comes before the alert's pages", async () => {
    await world.createAlert({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    const lastPost: number = world.events.lastIndexOf("slack:chat.postMessage");

    expect(world.events).toContain("paging");
    expect(world.events.indexOf("paging")).toBeGreaterThan(lastPost);
  });
});

describe("Alert Owner is none of Platform", () => {
  /*
   * The other side of the same gap: matched before its owners were in, an
   * alert Platform owns matched "is none of Platform", and its Alert Created
   * went to a channel that does not want Platform's alerts.
   */
  test("REGRESSION: an alert Platform owns from its create posts nothing there", async () => {
    postsToExistingChannel([
      ownedBy([PLATFORM_TEAM], ConditionType.NotContains),
    ]);

    await world.createAlert({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    expect(existingChannelPosts().filter(isCreated)).toEqual([]);
  });

  test("an alert somebody else owns is posted there", async () => {
    postsToExistingChannel([
      ownedBy([PLATFORM_TEAM], ConditionType.NotContains),
    ]);

    await world.createAlert({ ownersPicked: { users: [OWNER] } });

    expect(existingChannelPosts().filter(isCreated)).toHaveLength(1);
  });
});

describe("Alert Labels is any of database", () => {
  beforeEach(() => {
    postsToExistingChannel([labelled([DATABASE_LABEL])]);
  });

  test("REGRESSION: the channel gets Alert Created when a label rule attaches the label", async () => {
    world.labelRulesAttach = [DATABASE_LABEL];

    await world.createAlert();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(1);
    expect(isCreated(posts[0]!)).toBe(true);
  });

  test("an alert without the label posts nothing there", async () => {
    await world.createAlert();

    expect(existingChannelPosts()).toEqual([]);
  });
});

describe("a rule that opens a channel for Platform's alerts", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Platform's alert channels",
        eventType: NotificationRuleEventType.Alert,
        filters: [ownedBy([PLATFORM_TEAM])],
        inviteOwners: true,
      }),
    ];
  });

  test("REGRESSION: opens it as the alert is created, with Alert Created as its first message and Platform in it", async () => {
    await world.createAlert({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    expect(world.slackChannelsCreated()).toEqual(["alt-7"]);

    const posts: Array<string> = world.postsIn("C0NEW2");

    // Its first message announces the alert - not a channel opened later for it.
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

describe("every other rule hears of the alert as before", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Every alert",
        eventType: NotificationRuleEventType.Alert,
        createsChannel: false,
        existingChannels: EXISTING_CHANNEL.name,
      }),
      makeRule({
        id: OTHER_RULE_ID,
        name: "A channel for every alert",
        eventType: NotificationRuleEventType.Alert,
      }),
    ];
  });

  test("Alert Created first, then its owners - each message once, in each channel", async () => {
    await world.createAlert({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    for (const channelId of [EXISTING_CHANNEL.id, "C0NEW2"]) {
      const posts: Array<string> = world.postsIn(channelId);

      expect(posts).toHaveLength(2);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(isPlatformAdded(posts[1]!)).toBe(true);
    }
  });

  test("an alert with no owners: Alert Created alone", async () => {
    await world.createAlert();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(1);
    expect(isCreated(posts[0]!)).toBe(true);
  });
});

describe("the alert's feed", () => {
  test("starts with Alert Created, then its first state, then its owners", async () => {
    world.rules = [];

    await world.createAlert({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    const feed: Array<FeedRow> = world.feedInOrder(world.alertFeedRows);

    expect(
      feed.map((row: FeedRow): string => {
        return row.type;
      }),
    ).toEqual(["AlertCreated", "AlertStateChanged", "OwnerTeamAdded"]);
  });
});
