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
import { makeRule, OTHER_RULE_ID } from "./WorkspaceRuleWorld";
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
 * A NEW ON-CALL POLICY'S CHANNELS HEAR OF IT BEFORE THEY HEAR OF ITS
 * OWNERS.
 *
 * An on-call policy runs its label and owner rules before it opens its
 * channels and posts "On-Call Policy Created", so a rule that asks who owns
 * it or how it is labelled matches it. But adding an owner writes "Added
 * team Platform to the On-Call Policy as the owner", which was posted at
 * once: a channel a rule names heard of the owner before it heard of the
 * policy, and the policy's feed listed the owner above "On-Call Policy
 * Created". The owner's message now waits for the created message and
 * follows it (WorkspaceCreatedMessageFirst), and the created entry is filed
 * when the create began. Driven through the real OnCallDutyPolicyService
 * create hook, rule matching, channel creation, invites and messages
 * against a fake Slack (CreatedRecordWorld).
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

function ownedBy(ids: Array<ObjectID>): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyOwners,
    conditionType: ConditionType.ContainsAny,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

function labelled(ids: Array<ObjectID>): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
    conditionType: ConditionType.ContainsAny,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

// A rule that posts the on-call policies it matches to #platform-alerts.
function postsToExistingChannel(
  filters: Array<NotificationRuleCondition>,
): void {
  world.rules = [
    makeRule({
      name: "Platform's on-call policies",
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
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
  return post.includes("On-Call Policy Created");
}

function isPlatformAdded(post: string): boolean {
  return post.includes("Added team") && post.includes("Platform");
}

describe("a rule posting every on-call policy to an existing channel", () => {
  beforeEach(() => {
    postsToExistingChannel([]);
  });

  test("REGRESSION: the channel gets On-Call Policy Created, then the owner its owner rule added", async () => {
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createOnCallPolicy();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(2);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(isPlatformAdded(posts[1]!)).toBe(true);
  });

  test("a policy with no owners: On-Call Policy Created alone", async () => {
    await world.createOnCallPolicy();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(1);
    expect(isCreated(posts[0]!)).toBe(true);
  });
});

describe("On-Call Policy Owner is any of Platform, posting to an existing channel", () => {
  beforeEach(() => {
    postsToExistingChannel([ownedBy([PLATFORM_TEAM])]);
  });

  test("REGRESSION: the channel gets On-Call Policy Created first, then the owner", async () => {
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createOnCallPolicy();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(2);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(isPlatformAdded(posts[1]!)).toBe(true);
  });

  test("a policy Platform does not own posts nothing there", async () => {
    await world.createOnCallPolicy();

    expect(existingChannelPosts()).toEqual([]);
  });
});

describe("On-Call Policy Labels is any of database", () => {
  test("the channel gets On-Call Policy Created when a label rule attaches the label", async () => {
    postsToExistingChannel([labelled([DATABASE_LABEL])]);
    world.labelRulesAttach = [DATABASE_LABEL];

    await world.createOnCallPolicy();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(1);
    expect(isCreated(posts[0]!)).toBe(true);
  });
});

describe("a rule that opens a channel for Platform's on-call policies", () => {
  test("opens it as the policy is created: On-Call Policy Created first, then the owner, with Platform in it", async () => {
    world.rules = [
      makeRule({
        name: "Platform's on-call channels",
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        filters: [ownedBy([PLATFORM_TEAM])],
        inviteOwners: true,
      }),
    ];
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createOnCallPolicy();

    expect(world.slackChannelsCreated()).toHaveLength(1);

    const posts: Array<string> = world.postsIn("C0NEW2");

    expect(posts.length).toBeGreaterThan(0);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(posts.filter(isCreated)).toHaveLength(1);

    expect(world.slackUsersInvitedTo("C0NEW2")).toContain(
      PLATFORM_MEMBER_SLACK_ID,
    );
  });
});

describe("every rule's channel", () => {
  test("REGRESSION: On-Call Policy Created first, then its owners - each message once, in each channel", async () => {
    world.rules = [
      makeRule({
        name: "Every policy",
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        createsChannel: false,
        existingChannels: EXISTING_CHANNEL.name,
      }),
      makeRule({
        id: OTHER_RULE_ID,
        name: "A channel for every policy",
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
      }),
    ];
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createOnCallPolicy();

    for (const channelId of [EXISTING_CHANNEL.id, "C0NEW2"]) {
      const posts: Array<string> = world.postsIn(channelId);

      expect(posts).toHaveLength(2);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(isPlatformAdded(posts[1]!)).toBe(true);
    }
  });
});

describe("the on-call policy's feed", () => {
  test("REGRESSION: starts with On-Call Policy Created, then the owners its owner rules added", async () => {
    world.rules = [];
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createOnCallPolicy();

    const feed: Array<FeedRow> = world.feedInOrder(
      world.records.onCallPolicy.feedRows,
    );

    expect(
      feed.map((row: FeedRow): string => {
        return row.type;
      }),
    ).toEqual(["OnCallDutyPolicyCreated", "OwnerTeamAdded"]);
  });
});
