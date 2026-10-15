import IncidentOwnerUser from "../../../../Models/DatabaseModels/IncidentOwnerUser";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentOwnerUserService from "../../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../../Server/Services/IncidentService";
import WorkspaceNotificationRuleService, {
  WorkspaceChannelsCreated,
} from "../../../../Server/Services/WorkspaceNotificationRuleService";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceChannelName from "../../../../Utils/Workspace/WorkspaceChannelName";
import WorkspaceRuleWorld, {
  COMMANDER,
  INCIDENT_ID,
  LEFT_PROJECT,
  makeRule,
  NOT_CONNECTED,
  ON_CALL,
  OWNER,
  PROJECT_ID,
  RULE_USER,
  TEAM_ID,
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
 * EVERYONE THE RECORD HAS ALREADY JOINS ITS NEW CHANNEL.
 *
 * "Invite Incident owners to new Slack Channel" did not invite the owners
 * the incident had when its channel was created: an owner was invited only
 * when added after the channel existed. An incident a monitor declares gets
 * its owners straight after it is created, while its channel is still being
 * created - so the owners the monitor names were rarely invited, nor the
 * roles its criteria assign. Now the rule's channel is stored on the
 * incident first, and then everybody the rule adds who is on the incident
 * by then is invited: its owners, the people given a role, the people paged
 * so far. Whoever joins afterwards is invited by their own service, which
 * reads the channel the incident now holds.
 */

let world: WorkspaceRuleWorld;

beforeEach(() => {
  world = new WorkspaceRuleWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function page(userId: ObjectID): UserOnCallLog {
  const row: UserOnCallLog = new UserOnCallLog();
  row.userId = userId;
  row.projectId = PROJECT_ID;
  row.triggeredByIncidentId = INCIDENT_ID;
  return row;
}

describe("the people on the incident when its channel is created", () => {
  test("REGRESSION: its owners - owner users and the members of owner teams - join when the rule adds owners", async () => {
    world.rules = [makeRule({ inviteOwners: true })];
    world.incidentOwnerUsers = [OWNER];
    world.incidentOwnerTeams = [TEAM_ID];

    await world.createIncidentChannels();

    expect(world.slackUsersInvitedTo("C0NEW1")).toEqual(["U0OWNER", "U0TEAM"]);
  });

  test("its owners do not join when the rule does not add owners", async () => {
    world.rules = [makeRule({ inviteOwners: false, inviteRoles: false })];
    world.incidentOwnerUsers = [OWNER];

    await world.createIncidentChannels();

    expect(world.slackInvites()).toEqual([]);
  });

  test("the people given a role join when the rule adds roles", async () => {
    world.rules = [makeRule({ inviteRoles: true })];
    world.incidentMembers = [COMMANDER];

    await world.createIncidentChannels();

    expect(world.slackUsersInvitedTo("C0NEW1")).toEqual(["U0CMDR"]);
  });

  test("the people paged so far join when the rule adds on-call responders", async () => {
    world.rules = [makeRule({ inviteOnCall: true, inviteRoles: false })];
    world.pages = [page(ON_CALL)];

    await world.createIncidentChannels();

    expect(world.slackUsersInvitedTo("C0NEW1")).toEqual(["U0ONCALL"]);
  });

  test("the people the rule names come first, then the incident's own, each once", async () => {
    world.rules = [
      makeRule({
        inviteUsers: [RULE_USER],
        inviteTeams: [TEAM_ID],
        inviteOwners: true,
        inviteOnCall: true,
        inviteRoles: true,
      }),
    ];
    // OWNER is an owner, the commander and the person paged.
    world.incidentOwnerUsers = [OWNER];
    world.incidentMembers = [OWNER, COMMANDER];
    world.pages = [page(OWNER), page(ON_CALL), page(OWNER)];

    await world.createIncidentChannels();

    expect(world.slackUsersInvitedTo("C0NEW1")).toEqual([
      "U0RULE",
      "U0TEAM",
      // On-call responders, then roles, then owners: each person once.
      "U0OWNER",
      "U0ONCALL",
      "U0CMDR",
    ]);
  });

  test("somebody who left the project is not invited, and somebody not connected is named in the channel", async () => {
    world.rules = [makeRule({ inviteOwners: true })];
    world.projectMembers.delete(LEFT_PROJECT.toString());
    world.incidentOwnerUsers = [LEFT_PROJECT, NOT_CONNECTED, OWNER];

    const result: WorkspaceChannelsCreated | null =
      await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: PROJECT_ID,
          notificationRuleEventType: NotificationRuleEventType.Incident,
          notificationFor: { incidentId: INCIDENT_ID },
          channelNameParts: WorkspaceChannelName.forNumberedRecord({
            eventType: NotificationRuleEventType.Incident,
            number: 42,
            numberWithPrefix: "INC-42",
          }),
        },
      );

    expect(world.slackUsersInvitedTo("C0NEW1")).toEqual(["U0OWNER"]);
    expect(
      result?.membersNotAdded.map(
        (notAdded: { userIds: Array<ObjectID> }): Array<string> => {
          return notAdded.userIds.map((userId: ObjectID): string => {
            return userId.toString();
          });
        },
      ),
    ).toEqual([[NOT_CONNECTED.toString()]]);
  });

  test("an owner list that cannot be read leaves the rest invited", async () => {
    world.rules = [
      makeRule({ inviteOwners: true, inviteRoles: true, inviteOnCall: true }),
    ];
    world.incidentMembers = [COMMANDER];
    jest
      .spyOn(IncidentService, "findOwners")
      .mockRejectedValue(new Error("database is busy") as never);

    await world.createIncidentChannels();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
    expect(world.slackUsersInvitedTo("C0NEW1")).toEqual(["U0CMDR"]);
  });

  test("Microsoft Teams: the channel is created, and nobody is asked for one by one", async () => {
    world.connected = [WorkspaceType.MicrosoftTeams];
    world.rules = [
      makeRule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        inviteOwners: true,
        teamToCreateChannelIn: "team-ops",
      }),
    ];
    world.incidentOwnerUsers = [OWNER];

    await world.createIncidentChannels();

    expect(
      world.graphCreates.map((create: { displayName: string }) => {
        return create.displayName;
      }),
    ).toEqual(["inc-42"]);
    expect(world.slackRequests).toEqual([]);
  });
});

describe("the channel is on the incident before anybody is invited", () => {
  test("the store comes before the first invite", async () => {
    world.rules = [makeRule({ inviteOwners: true })];
    world.incidentOwnerUsers = [OWNER];

    await world.createIncidentChannels();

    const storeAt: number = world.events.indexOf("store:incident:inc-42");
    const inviteAt: number = world.events.indexOf("slack:conversations.invite");

    expect(storeAt).toBeGreaterThan(-1);
    expect(inviteAt).toBeGreaterThan(storeAt);
  });

  /*
   * A monitor's incident gets its owners straight after it is created,
   * while its channel is still being created. The owner's own hook reads the
   * incident's channels before they are stored and invites nobody; the
   * channel's setup then reads the incident's owners after storing it, and
   * invites them. Nobody added around the channel's creation is missed.
   */
  test("REGRESSION: an owner added while the channel is being created is invited", async () => {
    world.rules = [makeRule({ inviteOwners: true })];

    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);

    // The owner is added just as Slack creates the channel.
    let ownerAdded: Promise<void> | null = null;

    world.onSlackRequest = (request: { method: string }): void => {
      if (request.method !== "conversations.create" || ownerAdded) {
        return;
      }

      world.incidentOwnerUsers.push(OWNER);

      const owner: IncidentOwnerUser = new IncidentOwnerUser();
      owner.projectId = PROJECT_ID;
      owner.incidentId = INCIDENT_ID;
      owner.userId = OWNER;

      ownerAdded = IncidentOwnerUserService.onCreateSuccess(
        {
          createBy: { data: owner, props: { isRoot: true } },
          carryForward: null,
        },
        owner,
      ).then((): void => {
        return undefined;
      });
      world.started.push(ownerAdded);
    };

    await world.createIncidentChannels();
    await world.settle();

    expect(ownerAdded).not.toBeNull();
    // Invited by the channel's setup: the owner's hook found no channel yet.
    expect(world.slackUsersInvitedTo("C0NEW1")).toEqual(["U0OWNER"]);
  });
});

describe("the incident's list of channels says its setup ran", () => {
  test("an empty list when no rule asked for a channel", async () => {
    world.rules = [
      makeRule({ createsChannel: false, existingChannels: "#ops" }),
    ];

    await world.createIncidentChannels();

    expect(world.incident.channels).toEqual([]);
    expect(world.events).toContain("store:incident:");
  });

  test("nothing written when no workspace is connected", async () => {
    world.connected = [];

    await world.createIncidentChannels();

    expect(world.incident.channels).toBeNull();
    expect(
      world.events.filter((event: string): boolean => {
        return event.startsWith("store:");
      }),
    ).toEqual([]);
  });

  test("the channels created, when they were", async () => {
    world.rules = [makeRule({})];

    await world.createIncidentChannels();

    expect(
      (world.incident.channels || []).map((channel: { name: string }) => {
        return channel.name;
      }),
    ).toEqual(["inc-42"]);
  });

  test("never an empty list over channels created that could not be stored", async () => {
    world.rules = [makeRule({})];

    let stores: number = 0;
    jest
      .spyOn(IncidentService, "updateOneById")
      .mockImplementation((async (): Promise<void> => {
        stores++;
        throw new Error("database is busy");
      }) as never);

    await world.createIncidentChannels();

    // Tried once, for the channel; no empty list after it.
    expect(stores).toBe(1);
    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
  });
});
