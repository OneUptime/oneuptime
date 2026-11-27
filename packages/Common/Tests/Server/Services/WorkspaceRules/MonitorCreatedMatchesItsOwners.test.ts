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
 * A NOTIFICATION RULE THAT ASKS WHO OWNS A MONITOR, OR HOW IT IS LABELLED,
 * POSTS "MONITOR CREATED" (#11188).
 *
 * A Slack rule for monitors - "Monitor Owner is any of Platform", posting
 * to the existing channel #platform-alerts - never posted "Monitor
 * Created": the monitor's create chain opened its channels and posted its
 * created message before it added the owners picked on its form, its label
 * rules' labels and its owner rules' owners, so the rule did not match yet.
 * Its creator, made its owner as the create returns, missed it too. The
 * channel heard of the monitor only from "Added team Platform to the
 * Monitor as the owner". And "Monitor Created" listed the monitor's labels
 * as they were before its label rules ran.
 *
 * Now the chain adds them first, waits a moment for its creator, and only
 * then opens channels and posts "Monitor Created"; its first status and
 * the owners added meanwhile follow it. Driven through the real
 * MonitorService create chain, rule matching, channel creation, invites and
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
    checkOn: NotificationRuleConditionCheckOn.MonitorOwners,
    conditionType: conditionType,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

function labelled(ids: Array<ObjectID>): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.MonitorLabels,
    conditionType: ConditionType.ContainsAny,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

// A rule that posts the monitors it matches to #platform-alerts.
function postsToExistingChannel(
  filters: Array<NotificationRuleCondition>,
): void {
  world.rules = [
    makeRule({
      name: "Platform's monitors",
      eventType: NotificationRuleEventType.Monitor,
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
  return post.includes("Monitor Created");
}

// "Changed Monitor Checkout API State to Operational": its first status.
function isFirstStatus(post: string): boolean {
  return post.includes("Changed Monitor");
}

function isPlatformAdded(post: string): boolean {
  return post.includes("Added team") && post.includes("Platform");
}

// An owner added by name: the creator ("Somebody", as the world names people).
function isPersonAdded(post: string): boolean {
  return post.includes("Added") && post.includes("Somebody");
}

describe("Monitor Owner is any of Platform, posting to an existing channel", () => {
  beforeEach(() => {
    postsToExistingChannel([ownedBy([PLATFORM_TEAM])]);
  });

  test.each([
    [
      "picked on the Create Monitor form (or the API)",
      { ownersPicked: { teams: [PLATFORM_TEAM] } },
    ],
    ["added by an owner rule", { ownerRules: true }],
    [
      "added by the code that made it, once the create has returned",
      { callerAdds: { teams: [PLATFORM_TEAM] } },
    ],
  ])(
    "REGRESSION: the channel gets Monitor Created, then its first status, then the owner, when Platform is %s",
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

      await world.createMonitor({
        ownersPicked: setUp.ownersPicked,
        callerAdds: setUp.callerAdds,
      });

      const posts: Array<string> = existingChannelPosts();

      expect(posts).toHaveLength(3);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(isFirstStatus(posts[1]!)).toBe(true);
      expect(isPlatformAdded(posts[2]!)).toBe(true);
    },
  );

  test("REGRESSION: a monitor its creator owns, under a rule naming them: the creator is waited for", async () => {
    postsToExistingChannel([ownedBy([OWNER])]);

    await world.createMonitor({ creator: OWNER });

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(3);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(isFirstStatus(posts[1]!)).toBe(true);
    expect(isPersonAdded(posts[2]!)).toBe(true);
  });

  test("Monitor Created is posted there once, whatever adds Platform, however many times", async () => {
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createMonitor({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      callerAdds: { teams: [PLATFORM_TEAM] },
    });

    const posts: Array<string> = existingChannelPosts();

    expect(posts.filter(isCreated)).toHaveLength(1);
    expect(posts.filter(isFirstStatus)).toHaveLength(1);
    // Platform was added once: the rule and the caller found it there already.
    expect(posts.filter(isPlatformAdded)).toHaveLength(1);
  });

  test("a monitor Platform does not own posts nothing there", async () => {
    await world.createMonitor({ ownersPicked: { users: [OWNER] } });

    expect(existingChannelPosts()).toEqual([]);
  });
});

describe("Monitor Owner is none of Platform", () => {
  test("REGRESSION: a monitor Platform owns from its create posts nothing there", async () => {
    postsToExistingChannel([
      ownedBy([PLATFORM_TEAM], ConditionType.NotContains),
    ]);

    await world.createMonitor({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    expect(existingChannelPosts().filter(isCreated)).toEqual([]);
  });

  test("a monitor somebody else owns is posted there", async () => {
    postsToExistingChannel([
      ownedBy([PLATFORM_TEAM], ConditionType.NotContains),
    ]);

    await world.createMonitor({ ownersPicked: { users: [OWNER] } });

    expect(existingChannelPosts().filter(isCreated)).toHaveLength(1);
  });
});

describe("Monitor Labels is any of database", () => {
  beforeEach(() => {
    postsToExistingChannel([labelled([DATABASE_LABEL])]);
  });

  test("REGRESSION: the channel gets Monitor Created when a label rule attaches the label", async () => {
    world.labelRulesAttach = [DATABASE_LABEL];

    await world.createMonitor();

    const posts: Array<string> = existingChannelPosts();

    expect(posts.length).toBeGreaterThan(0);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(posts.filter(isCreated)).toHaveLength(1);
  });

  test("a monitor without the label posts nothing there", async () => {
    await world.createMonitor();

    expect(existingChannelPosts()).toEqual([]);
  });
});

describe("a rule that opens a channel for Platform's monitors", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Platform's monitor channels",
        eventType: NotificationRuleEventType.Monitor,
        filters: [ownedBy([PLATFORM_TEAM])],
        inviteOwners: true,
      }),
    ];
  });

  test("REGRESSION: opens it as the monitor is created, with Monitor Created as its first message and Platform in it", async () => {
    await world.createMonitor({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    expect(world.slackChannelsCreated()).toHaveLength(1);

    const posts: Array<string> = world.postsIn("C0NEW2");

    expect(posts.length).toBeGreaterThan(0);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(posts.filter(isCreated)).toHaveLength(1);

    // Platform's member joined the channel as it was set up.
    expect(world.slackUsersInvitedTo("C0NEW2")).toContain(
      PLATFORM_MEMBER_SLACK_ID,
    );
  });
});

describe("every other rule hears of the monitor as before", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Every monitor",
        eventType: NotificationRuleEventType.Monitor,
        createsChannel: false,
        existingChannels: EXISTING_CHANNEL.name,
      }),
      makeRule({
        id: OTHER_RULE_ID,
        name: "A channel for every monitor",
        eventType: NotificationRuleEventType.Monitor,
      }),
    ];
  });

  test("Monitor Created first, then its first status, then its owners - each message once, in each channel", async () => {
    await world.createMonitor({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    for (const channelId of [EXISTING_CHANNEL.id, "C0NEW2"]) {
      const posts: Array<string> = world.postsIn(channelId);

      expect(posts).toHaveLength(3);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(isFirstStatus(posts[1]!)).toBe(true);
      expect(isPlatformAdded(posts[2]!)).toBe(true);
    }
  });

  test("a monitor with no owners: Monitor Created, then its first status", async () => {
    await world.createMonitor();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(2);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(isFirstStatus(posts[1]!)).toBe(true);
  });

  test("REGRESSION: Monitor Created names the labels its label rules attached", async () => {
    world.labelRulesAttach = [DATABASE_LABEL];

    await world.createMonitor();

    const created: Array<string> = existingChannelPosts().filter(isCreated);

    expect(created).toHaveLength(1);
    expect(created[0]!).toContain("database");
  });
});

describe("the monitor's feed", () => {
  test("starts with Monitor Created, then its first status, then its owners", async () => {
    world.rules = [];

    await world.createMonitor({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      creator: OWNER,
    });

    const feed: Array<FeedRow> = world.feedInOrder(
      world.records.monitor.feedRows,
    );

    expect(
      feed.map((row: FeedRow): string => {
        return row.type;
      }),
    ).toEqual([
      "MonitorCreated",
      "MonitorStatusChanged",
      "OwnerTeamAdded",
      "OwnerUserAdded",
    ]);
  });
});
