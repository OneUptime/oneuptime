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
 * A NOTIFICATION RULE THAT ASKS WHO OWNS A MAINTENANCE EVENT, OR HOW IT IS
 * LABELLED, POSTS "SCHEDULED MAINTENANCE CREATED" (#11188).
 *
 * A Slack rule for scheduled maintenance - "Scheduled Maintenance Owner is
 * any of Platform", posting to the existing channel #platform-alerts -
 * never posted "Scheduled Maintenance SM-5 Created": the event's create
 * chain opened its channels and posted its created message before it added
 * the owners picked on its form, its owner rules' owners and its label
 * rules' labels, so the rule did not match yet. Its creator, made its owner
 * as the create returns, missed it too. An event's owners were written to
 * its feed and not posted, so the channel never heard of the event at all.
 *
 * Now the chain adds them first, waits a moment for its creator, and only
 * then opens channels and posts "Scheduled Maintenance Created". Its owners
 * are posted too since #11223, as every other kind's are: each follows
 * "Scheduled Maintenance Created", in the order it was added
 * (ScheduledMaintenanceOwnersReachChat.test.ts). Driven through the real
 * ScheduledMaintenanceService create chain, rule matching, channel
 * creation, invites and messages against a fake Slack (CreatedRecordWorld).
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
    checkOn: NotificationRuleConditionCheckOn.ScheduledMaintenanceOwners,
    conditionType: conditionType,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

function labelled(ids: Array<ObjectID>): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels,
    conditionType: ConditionType.ContainsAny,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

// A rule that posts the events it matches to #platform-alerts.
function postsToExistingChannel(
  filters: Array<NotificationRuleCondition>,
): void {
  world.rules = [
    makeRule({
      name: "Platform's maintenance",
      eventType: NotificationRuleEventType.ScheduledMaintenance,
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
  return post.includes("Scheduled Maintenance SM-5 Created");
}

// "Added team Platform to the Scheduled Maintenance SM-5 as the owner."
function isPlatformAdded(post: string): boolean {
  return (
    post.includes("Added team") &&
    post.includes("Platform") &&
    post.includes("Scheduled Maintenance SM-5")
  );
}

// "Added Somebody to the Scheduled Maintenance SM-5 as the owner": a person.
function isPersonAdded(post: string): boolean {
  return (
    post.includes("Added") &&
    !post.includes("Added team") &&
    post.includes("Scheduled Maintenance SM-5") &&
    post.includes("as the owner")
  );
}

describe("Scheduled Maintenance Owner is any of Platform, posting to an existing channel", () => {
  beforeEach(() => {
    postsToExistingChannel([ownedBy([PLATFORM_TEAM])]);
  });

  test.each([
    [
      "picked on the Create Maintenance Event form (or the API)",
      { ownersPicked: { teams: [PLATFORM_TEAM] } },
    ],
    ["added by an owner rule", { ownerRules: true }],
  ])(
    "REGRESSION: the channel gets Scheduled Maintenance Created when Platform is %s",
    async (
      _how: string,
      setUp: {
        ownersPicked?: { teams: Array<ObjectID> };
        ownerRules?: boolean;
      },
    ) => {
      if (setUp.ownerRules) {
        world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };
      }

      await world.createScheduledMaintenance({
        ownersPicked: setUp.ownersPicked,
      });

      const posts: Array<string> = existingChannelPosts();

      // Created first, then Platform, as its owner (#11223).
      expect(posts).toHaveLength(2);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(isPlatformAdded(posts[1]!)).toBe(true);
    },
  );

  test("REGRESSION: an event its creator owns, under a rule naming them: the creator is waited for", async () => {
    postsToExistingChannel([ownedBy([OWNER])]);

    await world.createScheduledMaintenance({ creator: OWNER });

    const posts: Array<string> = existingChannelPosts();

    // Created first, then its creator, as its owner (#11223).
    expect(posts).toHaveLength(2);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(isPersonAdded(posts[1]!)).toBe(true);
  });

  test("Scheduled Maintenance Created is posted there once, whatever adds Platform, however many times", async () => {
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    expect(existingChannelPosts().filter(isCreated)).toHaveLength(1);
    // Platform was added once: the rule found it there already.
    expect(world.records.scheduledMaintenance.ownerTeams).toEqual([
      PLATFORM_TEAM,
    ]);
    // And said once, after Created (#11223).
    expect(existingChannelPosts().filter(isPlatformAdded)).toHaveLength(1);
  });

  test("an event Platform does not own posts nothing there, its owners neither", async () => {
    await world.createScheduledMaintenance({
      ownersPicked: { users: [OWNER] },
    });

    expect(existingChannelPosts()).toEqual([]);
  });
});

describe("Scheduled Maintenance Owner is none of Platform", () => {
  test("REGRESSION: an event Platform owns from its create posts nothing there", async () => {
    postsToExistingChannel([
      ownedBy([PLATFORM_TEAM], ConditionType.NotContains),
    ]);

    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    expect(existingChannelPosts().filter(isCreated)).toEqual([]);
  });

  test("an event somebody else owns is posted there", async () => {
    postsToExistingChannel([
      ownedBy([PLATFORM_TEAM], ConditionType.NotContains),
    ]);

    await world.createScheduledMaintenance({
      ownersPicked: { users: [OWNER] },
    });

    expect(existingChannelPosts().filter(isCreated)).toHaveLength(1);
  });
});

describe("Scheduled Maintenance Labels is any of database", () => {
  beforeEach(() => {
    postsToExistingChannel([labelled([DATABASE_LABEL])]);
  });

  test("REGRESSION: the channel gets Scheduled Maintenance Created when a label rule attaches the label", async () => {
    world.labelRulesAttach = [DATABASE_LABEL];

    await world.createScheduledMaintenance();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(1);
    expect(isCreated(posts[0]!)).toBe(true);
  });

  test("an event without the label posts nothing there", async () => {
    await world.createScheduledMaintenance();

    expect(existingChannelPosts()).toEqual([]);
  });
});

describe("a rule that opens a channel for Platform's maintenance events", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Platform's maintenance channels",
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        filters: [ownedBy([PLATFORM_TEAM])],
        inviteOwners: true,
      }),
    ];
  });

  test("REGRESSION: opens it as the event is created, with Scheduled Maintenance Created as its first message and Platform in it", async () => {
    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    expect(world.slackChannelsCreated()).toHaveLength(1);

    const posts: Array<string> = world.postsIn("C0NEW2");

    expect(posts.length).toBeGreaterThan(0);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(posts.filter(isCreated)).toHaveLength(1);
    // Then Platform, as its owner, once (#11223).
    expect(posts.filter(isPlatformAdded)).toHaveLength(1);
    expect(isPlatformAdded(posts[posts.length - 1]!)).toBe(true);

    // Platform's member joined the channel as it was set up.
    expect(world.slackUsersInvitedTo("C0NEW2")).toContain(
      PLATFORM_MEMBER_SLACK_ID,
    );
  });
});

describe("every other rule hears of the maintenance event as before", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Every event",
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
  });

  test("REGRESSION (#11223): Scheduled Maintenance Created, once, in each channel, then its owners, each once", async () => {
    await world.createScheduledMaintenance({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      creator: OWNER,
    });

    for (const channelId of [EXISTING_CHANNEL.id, "C0NEW2"]) {
      const posts: Array<string> = world.postsIn(channelId);

      expect(posts).toHaveLength(3);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(isPlatformAdded(posts[1]!)).toBe(true);
      expect(isPersonAdded(posts[2]!)).toBe(true);
    }
  });
});

describe("the maintenance event's feed", () => {
  test("starts with Scheduled Maintenance Created, then its first state, then its owners", async () => {
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
  });
});
