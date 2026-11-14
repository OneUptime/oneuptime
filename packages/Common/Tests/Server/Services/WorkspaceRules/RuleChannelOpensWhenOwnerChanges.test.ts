import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceRuleWorld, {
  makeRule,
  OWNER,
  TEAM_ID,
  TEAM_USER,
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
 * A RULE THAT MATCHES ON WHO OWNS AN INCIDENT ACTS WHEN THE OWNER IS ADDED
 * LATER (#7583).
 *
 * Owners are often added after an incident is created: by owner rules, by
 * a template, by a person a minute later. "Incident Owner is any of
 * Platform" cannot match while the incident has no owners, so its channel
 * opens when the team is added - the owner's arrival is posted to the
 * incident's feed, and every post checks the rules again
 * (createChannelsForRulesThatNowMatch). Owners are taken as recorded: a
 * person who is only a member of the owning team is not an owner.
 *
 * Driven through the real rule matching, channel creation, invites and
 * messages against a fake Slack API; only the database is in memory
 * (WorkspaceRuleWorld), its owner tables included.
 */

let world: WorkspaceRuleWorld;

beforeEach(() => {
  world = new WorkspaceRuleWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function ownedBy(
  conditionType: ConditionType,
  ids: Array<ObjectID>,
): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.IncidentOwners,
    conditionType: conditionType,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

// The owner's arrival or departure, as the incident's feed posts it.
async function postOwnersChanged(): Promise<void> {
  await world.postAboutIncident(
    "👨🏻‍💻 Changed the owners of [Incident INC-42](https://oneuptime.test/dashboard/incidents/42).",
  );
}

describe("Incident Owner is any of a team", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Platform's incidents",
        filters: [ownedBy(ConditionType.ContainsAny, [TEAM_ID])],
        inviteOwners: true,
      }),
    ];
  });

  test("creates no channel while the incident has no owners", async () => {
    await world.createIncidentChannels();

    expect(world.slackChannelsCreated()).toEqual([]);
  });

  test("REGRESSION: opens the channel when the team is added as an owner after the incident is created", async () => {
    await world.createIncidentChannels();
    expect(world.slackChannelsCreated()).toEqual([]);

    world.incidentOwnerTeams = [TEAM_ID];
    await postOwnersChanged();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
    // The rule invites the incident's owners: the team's member joins it.
    expect(world.slackUsersInvitedTo("C0NEW1")).toEqual(["U0TEAM"]);
  });

  test("opens it with the incident when the team owns it from the start", async () => {
    world.incidentOwnerTeams = [TEAM_ID];

    await world.createIncidentChannels();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
  });

  test("opens it once: a second owner added later opens nothing more", async () => {
    world.incidentOwnerTeams = [TEAM_ID];
    await world.createIncidentChannels();

    world.incidentOwnerUsers = [OWNER];
    await postOwnersChanged();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
  });
});

describe("Incident Owner is any of a person", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Incidents the team member owns",
        filters: [ownedBy(ConditionType.ContainsAny, [TEAM_USER])],
      }),
    ];
  });

  test("a member of the owning team is not an owner by being in it", async () => {
    await world.createIncidentChannels();

    world.incidentOwnerTeams = [TEAM_ID];
    await postOwnersChanged();

    expect(world.slackChannelsCreated()).toEqual([]);
  });

  test("opens the channel once the person is added as an owner", async () => {
    world.incidentOwnerTeams = [TEAM_ID];
    await world.createIncidentChannels();
    expect(world.slackChannelsCreated()).toEqual([]);

    world.incidentOwnerUsers = [TEAM_USER];
    await postOwnersChanged();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
  });
});

describe("Incident Owner is none of a team", () => {
  beforeEach(() => {
    world.rules = [
      makeRule({
        name: "Incidents Platform does not own",
        filters: [ownedBy(ConditionType.NotContains, [TEAM_ID])],
      }),
    ];
  });

  test("opens the channel when the team is taken off the incident's owners", async () => {
    world.incidentOwnerTeams = [TEAM_ID];
    await world.createIncidentChannels();
    expect(world.slackChannelsCreated()).toEqual([]);

    world.incidentOwnerTeams = [];
    await postOwnersChanged();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
  });

  test("an incident nobody owns matches from the start", async () => {
    await world.createIncidentChannels();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
  });
});

describe("the owners are read only for a rule that asks who owns the incident", () => {
  test("a rule without an owners condition reads no owner table", async () => {
    world.rules = [makeRule({ name: "Every incident" })];
    world.incidentOwnerTeams = [TEAM_ID];

    await world.createIncidentChannels();
    await postOwnersChanged();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
    expect(world.ownerTableReads).toBe(0);
  });

  test("a rule with one reads the people and the teams each time the rules are checked", async () => {
    world.rules = [
      makeRule({ filters: [ownedBy(ConditionType.ContainsAny, [TEAM_ID])] }),
    ];

    await world.createIncidentChannels();
    expect(world.ownerTableReads).toBe(2);

    world.incidentOwnerTeams = [TEAM_ID];
    await postOwnersChanged();

    expect(world.ownerTableReads).toBeGreaterThan(2);
    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
  });
});
