import UserService from "../../../../Server/Services/UserService";
import PendingInviteeProfiles from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import CreatedRecordWorld, {
  DATABASE_LABEL,
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
  SLACK_USER_IDS,
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
 * when the create began.
 *
 * ITS CREATOR COUNTS AS ITS OWNER TOO (#11224). The person who creates a
 * policy in the Dashboard is made its owner as the create returns
 * (autoOwnerOnCreate) - after its create hook, which used to announce the
 * policy itself: a rule "On-Call Policy Owner is any of Ana" missed "On-Call
 * Policy Created" for the policy Ana made, and its channel heard first that
 * she was added. The announcement now runs once the create has returned,
 * after a moment's wait for the creator (WorkspaceRuleOwnersOnCreate), as
 * every other kind's does. Driven through the real OnCallDutyPolicyService
 * create hook, rule matching, channel creation, invites and messages
 * against a fake Slack (CreatedRecordWorld).
 */

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

  // Nobody here is only invited: each is named by their name.
  jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockResolvedValue(new Map() as never);
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
    checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyOwners,
    conditionType: conditionType,
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

// "Added Ana Lee to the On-Call Policy Platform on-call as the owner."
function isAdded(name: string): (post: string) => boolean {
  return (post: string): boolean => {
    return (
      post.includes("Added") &&
      post.includes(name) &&
      post.includes("On-Call Policy Platform on-call") &&
      post.includes("as the owner")
    );
  };
}

/*
 * What a post is, from its text: the policy's Created message, or an owner
 * added - Platform, or a person by their name.
 */
function describePost(post: string): string {
  if (isCreated(post)) {
    return "Created";
  }

  if (isPlatformAdded(post)) {
    return "Platform added";
  }

  for (const name of Object.values(NAMES)) {
    if (isAdded(name)(post)) {
      return `${name} added`;
    }
  }

  return post.slice(0, 60);
}

function said(channelId: string): Array<string> {
  return world.postsIn(channelId).map(describePost);
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

  test("starts with On-Call Policy Created, then the owner rules' owners, then its creator - also now that the creator is waited for", async () => {
    world.rules = [
      makeRule({
        name: "Ana's on-call policies",
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        filters: [ownedBy([OWNER])],
        createsChannel: false,
        existingChannels: EXISTING_CHANNEL.name,
      }),
    ];
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createOnCallPolicy({ creator: OWNER });

    const feed: Array<FeedRow> = world.feedInOrder(
      world.records.onCallPolicy.feedRows,
    );

    expect(
      feed.map((row: FeedRow): string => {
        return row.type;
      }),
    ).toEqual(["OnCallDutyPolicyCreated", "OwnerTeamAdded", "OwnerUserAdded"]);
  });
});

describe("On-Call Policy Owner is any of the person who creates it (#11224)", () => {
  beforeEach(() => {
    postsToExistingChannel([ownedBy([OWNER])]);
  });

  test("REGRESSION (#11224): the channel gets On-Call Policy Created, then its creator as its owner", async () => {
    await world.createOnCallPolicy({ creator: OWNER });

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created", "Ana Lee added"]);
  });

  test("REGRESSION (#11224): with an owner rule's team too: Created first, then the team, then its creator, each once", async () => {
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createOnCallPolicy({ creator: OWNER });

    expect(said(EXISTING_CHANNEL.id)).toEqual([
      "Created",
      "Platform added",
      "Ana Lee added",
    ]);
  });

  test("a policy somebody else creates posts nothing there", async () => {
    await world.createOnCallPolicy({ creator: RULE_USER });

    expect(said(EXISTING_CHANNEL.id)).toEqual([]);
  });

  test("a policy made by no person - an API key, OneUptime itself - posts nothing there", async () => {
    await world.createOnCallPolicy();

    expect(said(EXISTING_CHANNEL.id)).toEqual([]);
  });
});

describe("On-Call Policy Owner is none of the person who creates it (#11224)", () => {
  beforeEach(() => {
    postsToExistingChannel([ownedBy([OWNER], ConditionType.NotContains)]);
  });

  test("REGRESSION (#11224): a policy Ana creates is not posted there: she owns it from its create", async () => {
    await world.createOnCallPolicy({ creator: OWNER });

    expect(said(EXISTING_CHANNEL.id)).toEqual([]);
  });

  test("a policy somebody else creates is posted there, then its creator", async () => {
    await world.createOnCallPolicy({ creator: RULE_USER });

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created", "Ravi Shah added"]);
  });
});

describe("a rule that opens a channel for the policies of the person who creates them (#11224)", () => {
  test("REGRESSION (#11224): opens it as the policy is created, with On-Call Policy Created as its first message and its creator in it", async () => {
    world.rules = [
      makeRule({
        name: "Ana's on-call channels",
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        filters: [ownedBy([OWNER])],
        inviteOwners: true,
      }),
    ];

    await world.createOnCallPolicy({ creator: OWNER });

    expect(world.slackChannelsCreated()).toHaveLength(1);
    expect(said("C0NEW2")).toEqual(["Created", "Ana Lee added"]);

    // She was in it as it was set up: an owner already.
    expect(world.slackUsersInvitedTo("C0NEW2")).toContain(
      SLACK_USER_IDS[OWNER.toString()],
    );
  });
});

describe("owners the code that made the policy adds once its create has returned (#11224)", () => {
  test("REGRESSION (#11224): are waited for too: a rule naming them gets On-Call Policy Created, then them", async () => {
    postsToExistingChannel([ownedBy([PLATFORM_TEAM])]);

    await world.createOnCallPolicy({
      callerAdds: { teams: [PLATFORM_TEAM] },
    });

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created", "Platform added"]);
  });
});

describe("every rule hears of a policy its creator owns", () => {
  test("Created first, then the owner rule's team, then the creator - each message once, in each channel", async () => {
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
        inviteOwners: true,
      }),
    ];
    world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

    await world.createOnCallPolicy({ creator: OWNER });

    for (const channelId of [EXISTING_CHANNEL.id, "C0NEW2"]) {
      expect({ channelId, said: said(channelId) }).toEqual({
        channelId,
        said: ["Created", "Platform added", "Ana Lee added"],
      });
    }
  });

  test("in a project with no rule that asks who owns a policy, nothing waits for the creator, who still follows On-Call Policy Created", async () => {
    postsToExistingChannel([]);

    await world.createOnCallPolicy({ creator: OWNER });

    expect(said(EXISTING_CHANNEL.id)).toEqual(["Created", "Ana Lee added"]);
  });
});
