import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { StartingStage } from "../../../../Utils/StartingStage";
import CreatedRecordWorld, {
  DATABASE_LABEL,
  EXISTING_CHANNEL,
  FeedRow,
  PLATFORM_MEMBER_SLACK_ID,
  PLATFORM_TEAM,
} from "./CreatedRecordWorld";
import {
  COMMANDER,
  makeRule,
  OTHER_RULE_ID,
  OWNER,
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
 * AN INCIDENT'S NOTIFICATION RULES SEE ITS OWNERS AND LABELS AS IT IS
 * CREATED (#11146), AND ITS FEED STARTS WITH WHAT IT WAS DECLARED FROM
 * (#10911).
 *
 * Incidents had the alert's gap: the create chain opened the incident's
 * channels and posted "Incident Created" before it added the owners of the
 * alerts it was declared from, the owners picked on its form or template,
 * its owner rules' owners and its label rules' labels. A rule that asks who
 * owns an incident, or how it is labelled, never posted "Incident Created".
 *
 * And an incident declared from an alert listed "Declared from 1 alert"
 * after "created Incident", the Incident Commander the Dashboard gives the
 * declarer and its owners. Declaring it from the alert is what made it: it
 * is the first line of its feed now, and "Incident Created" the second.
 *
 * Driven through the real IncidentService create chain, rule matching,
 * channel creation, invites, feed entries and messages against a fake
 * Slack (CreatedRecordWorld).
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
    checkOn: NotificationRuleConditionCheckOn.IncidentOwners,
    conditionType: conditionType,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

function labelled(ids: Array<ObjectID>): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
    conditionType: ConditionType.ContainsAny,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

function postsToExistingChannel(
  filters: Array<NotificationRuleCondition>,
): void {
  world.rules = [
    makeRule({
      name: "Platform's incidents",
      filters: filters,
      createsChannel: false,
      existingChannels: EXISTING_CHANNEL.name,
    }),
  ];
}

function existingChannelPosts(): Array<string> {
  return world.postsIn(EXISTING_CHANNEL.id);
}

function isCreated(post: string): boolean {
  return post.includes("Incident INC-42 Created");
}

function isDeclaredFrom(post: string): boolean {
  return post.includes("Declared from 1 alert");
}

function isPlatformAdded(post: string): boolean {
  return post.includes("Added team") && post.includes("Platform");
}

function types(rows: Array<FeedRow>): Array<string> {
  return rows.map((row: FeedRow): string => {
    return row.type;
  });
}

describe("Incident Owner is any of Platform, posting to an existing channel", () => {
  beforeEach(() => {
    postsToExistingChannel([ownedBy([PLATFORM_TEAM])]);
  });

  test.each([
    [
      "picked on the declare form, a template or a form (handed over with the create)",
      { ownersPicked: { teams: [PLATFORM_TEAM] } },
    ],
    [
      "an owner of the alert it is declared from",
      { declaredFromAlerts: true, declaredAlertOwners: true },
    ],
    ["added by an owner rule", { ownerRules: true }],
    [
      "named by the monitor's criteria, added once the create has returned",
      { callerAdds: { teams: [PLATFORM_TEAM] } },
    ],
  ])(
    "REGRESSION: the channel gets Incident Created, first, when Platform is %s",
    async (
      _how: string,
      setUp: {
        ownersPicked?: { teams: Array<ObjectID> };
        declaredFromAlerts?: boolean;
        declaredAlertOwners?: boolean;
        ownerRules?: boolean;
        callerAdds?: { teams: Array<ObjectID> };
      },
    ) => {
      if (setUp.ownerRules) {
        world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };
      }

      if (setUp.declaredAlertOwners) {
        world.declaredAlertOwners = { teams: [PLATFORM_TEAM] };
      }

      await world.createIncident({
        ownersPicked: setUp.ownersPicked,
        declaredFromAlerts: setUp.declaredFromAlerts,
        callerAdds: setUp.callerAdds,
      });

      const posts: Array<string> = existingChannelPosts();

      expect(posts.length).toBeGreaterThan(0);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(posts.filter(isCreated)).toHaveLength(1);
      expect(posts.filter(isPlatformAdded)).toHaveLength(1);
    },
  );

  test("REGRESSION: an incident its creator owns, under a rule naming them: the creator is waited for", async () => {
    postsToExistingChannel([ownedBy([OWNER])]);

    await world.createIncident({ creator: OWNER });

    const posts: Array<string> = existingChannelPosts();

    expect(posts.length).toBeGreaterThan(0);
    expect(isCreated(posts[0]!)).toBe(true);
  });

  test("an incident declared already acknowledged is matched on its owners too, and pages nobody", async () => {
    await world.createIncident({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      startingStage: StartingStage.Acknowledged,
    });

    expect(isCreated(existingChannelPosts()[0]!)).toBe(true);
  });

  test("an incident declared already resolved still has its Incident Created go to the channels its rules name", async () => {
    await world.createIncident({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      startingStage: StartingStage.Resolved,
    });

    // No channel of its own: it is over. Its created message still goes where its rules say.
    expect(world.slackChannelsCreated()).toEqual([]);
    expect(isCreated(existingChannelPosts()[0]!)).toBe(true);
  });

  test("Incident Created comes before the incident's pages", async () => {
    await world.createIncident({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    const lastPost: number = world.events.lastIndexOf("slack:chat.postMessage");

    expect(world.events).toContain("paging");
    expect(world.events.indexOf("paging")).toBeGreaterThan(lastPost);
  });
});

describe("Incident Owner is none of Platform", () => {
  test("REGRESSION: an incident Platform owns from its create posts nothing there", async () => {
    postsToExistingChannel([
      ownedBy([PLATFORM_TEAM], ConditionType.NotContains),
    ]);

    await world.createIncident({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    expect(existingChannelPosts().filter(isCreated)).toEqual([]);
  });
});

describe("Incident Labels is any of database", () => {
  test("REGRESSION: the channel gets Incident Created when a label rule attaches the label", async () => {
    postsToExistingChannel([labelled([DATABASE_LABEL])]);
    world.labelRulesAttach = [DATABASE_LABEL];

    await world.createIncident();

    const posts: Array<string> = existingChannelPosts();

    expect(posts).toHaveLength(1);
    expect(isCreated(posts[0]!)).toBe(true);
  });
});

describe("a rule that opens a channel for Platform's incidents", () => {
  test("REGRESSION: opens it as the incident is created, Incident Created first, Platform in it", async () => {
    world.rules = [
      makeRule({
        name: "Platform's incident channels",
        filters: [ownedBy([PLATFORM_TEAM])],
        inviteOwners: true,
      }),
    ];

    await world.createIncident({ ownersPicked: { teams: [PLATFORM_TEAM] } });

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);

    const posts: Array<string> = world.postsIn("C0NEW2");

    expect(posts.length).toBeGreaterThan(0);
    expect(isCreated(posts[0]!)).toBe(true);
    expect(
      posts.some((post: string): boolean => {
        return post.includes("This channel is for");
      }),
    ).toBe(false);
    expect(world.slackUsersInvitedTo("C0NEW2")).toContain(
      PLATFORM_MEMBER_SLACK_ID,
    );
  });
});

describe("an incident declared from an alert (#10911)", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Every incident",
        createsChannel: false,
        existingChannels: EXISTING_CHANNEL.name,
      }),
      makeRule({
        id: OTHER_RULE_ID,
        name: "A channel for every incident",
      }),
    ];
    world.declaredAlertOwners = { teams: [PLATFORM_TEAM] };
  });

  test("REGRESSION: its feed starts with what it was declared from, then Incident Created, then its state and owners", async () => {
    await world.createIncident({
      declaredFromAlerts: true,
      ownersPicked: { users: [OWNER] },
      creator: COMMANDER,
    });

    const feed: Array<FeedRow> = world.feedInOrder(world.incidentFeedRows);

    expect(types(feed).slice(0, 2)).toEqual(["AlertLinked", "IncidentCreated"]);
    expect(feed[0]!.markdown).toContain("Declared from 1 alert");
    expect(feed[0]!.markdown).toContain("ALT-6");

    /*
     * Then its first state and its owners - the alert's, the ones picked,
     * its creator - each as it was written: its creator is made its owner
     * as the create returns, whenever the chain reaches its first state.
     */
    expect(types(feed).slice(2).sort()).toEqual([
      "IncidentStateChanged",
      "OwnerTeamAdded",
      "OwnerUserAdded",
      "OwnerUserAdded",
    ]);
  });

  test("REGRESSION: the Incident Commander the Dashboard gives the declarer as the page opens comes after it too", async () => {
    // The declare returns; the Dashboard gives the declarer the commander's role while the chain still runs.
    world.onFirstState = async (): Promise<void> => {
      world.onFirstState = null;
      await world.assignCommander(COMMANDER);
    };

    await world.createIncident({ declaredFromAlerts: true });

    const feed: Array<FeedRow> = world.feedInOrder(world.incidentFeedRows);

    expect(types(feed)[0]).toBe("AlertLinked");
    expect(types(feed)[1]).toBe("IncidentCreated");
    expect(types(feed)).toContain("IncidentMemberAdded");
  });

  test("its messages: Incident Created first, then what it was declared from, then its owners - each once", async () => {
    await world.createIncident({ declaredFromAlerts: true });

    for (const channelId of [EXISTING_CHANNEL.id, "C0NEW2"]) {
      const posts: Array<string> = world.postsIn(channelId);

      expect(posts).toHaveLength(3);
      expect(isCreated(posts[0]!)).toBe(true);
      expect(isDeclaredFrom(posts[1]!)).toBe(true);
      expect(isPlatformAdded(posts[2]!)).toBe(true);
    }
  });

  test("the declared-from entry is filed a millisecond before Incident Created", async () => {
    await world.createIncident({ declaredFromAlerts: true });

    const declaredFrom: FeedRow = world.incidentFeedRows.find(
      (row: FeedRow): boolean => {
        return row.type === "AlertLinked";
      },
    )!;
    const created: FeedRow = world.incidentFeedRows.find(
      (row: FeedRow): boolean => {
        return row.type === "IncidentCreated";
      },
    )!;

    expect(created.postedAt.getTime() - declaredFrom.postedAt.getTime()).toBe(
      1,
    );
  });
});

describe("an incident declared without alerts", () => {
  test("its feed starts with Incident Created, ahead of the owners its create adds", async () => {
    world.rules = [];

    await world.createIncident({
      ownersPicked: { teams: [PLATFORM_TEAM] },
      creator: OWNER,
    });

    const feed: Array<FeedRow> = world.feedInOrder(world.incidentFeedRows);

    expect(types(feed)[0]).toBe("IncidentCreated");
    expect(types(feed).slice(1).sort()).toEqual([
      "IncidentStateChanged",
      "OwnerTeamAdded",
      "OwnerUserAdded",
    ]);
    expect(types(feed)).not.toContain("AlertLinked");
  });
});
