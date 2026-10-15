import IncidentEpisodeMember from "../../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeRoleMember from "../../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "../../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../../Models/DatabaseModels/IncidentRole";
import WorkspaceNotificationLog from "../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import IncidentEpisodeMemberService from "../../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeRoleMemberService from "../../../../Server/Services/IncidentEpisodeRoleMemberService";
import IncidentMemberService from "../../../../Server/Services/IncidentMemberService";
import IncidentRoleService from "../../../../Server/Services/IncidentRoleService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ObjectID from "../../../../Types/ObjectID";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationActionType from "../../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceRuleWorld, {
  COMMANDER,
  COMMANDER_ROLE_ID,
  CRITICAL_SEVERITY_ID,
  INCIDENT_EPISODE_ID,
  INCIDENT_ID,
  LEFT_PROJECT,
  makeRule,
  MINOR_SEVERITY_ID,
  NOT_CONNECTED,
  ON_CALL,
  OTHER_RULE_ID,
  PROJECT_ID,
  RULE_ID,
  TEAMS_TEAM_ID,
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
 * THE INCIDENT COMMANDER JOINS THE INCIDENT'S CHANNEL.
 *
 * A customer: "We want the Incident Commander automatically invited to the
 * Slack channel for every incident. We configured an Incident Notification
 * Rule and enabled 'Automatically Invite On Call Users to New Slack
 * Channel'. The channel is created, but the commander is not invited. We
 * suspect this happens because the commander is only assigned once the
 * alert is acknowledged."
 *
 * They were right that the commander is assigned at acknowledgement -
 * whoever first changes the incident's state becomes its commander - but
 * the rule ran long before, and then never looked again: an incident's
 * roles were added to its channel only by the rule's OWNERS switch, which
 * this customer had off. Now the people given a role have a switch of their
 * own ("Incident Commander and other incident roles, as they are
 * assigned"), and a rule that does not say - every rule saved before it -
 * adds them when it adds the owners or the people paged on call.
 *
 * Driven through the real member hook, rule lookup, invite path and
 * SlackUtil against a fake Slack API; only the database is in memory
 * (WorkspaceRuleWorld).
 */

let world: WorkspaceRuleWorld;

beforeEach(() => {
  world = new WorkspaceRuleWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The customer's rule: a channel for every incident, the people paged invited, owners not.
function customersRule(
  options: { inviteRoles?: boolean | undefined } = {},
): void {
  world.rules = [
    makeRule({
      inviteOnCall: true,
      inviteOwners: false,
      ...(options.inviteRoles !== undefined
        ? { inviteRoles: options.inviteRoles }
        : {}),
    }),
  ];
}

// The incident's channel, as Slack created it.
function incidentChannelId(): string {
  const channels: Array<{ id: string }> = world.incident.channels || [];
  expect(channels).toHaveLength(1);
  return channels[0]!.id;
}

describe("the customer's rule: on-call responders invited, owners not, saved before roles had a switch", () => {
  test("the incident's channel is created as inc-42, and the person paged joins it", async () => {
    customersRule();

    await world.createIncidentChannels();
    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);

    await world.page(ON_CALL);

    expect(world.slackUsersInvitedTo(incidentChannelId())).toEqual([
      "U0ONCALL",
    ]);
  });

  test("REGRESSION: the commander assigned when someone else acknowledges joins it too", async () => {
    customersRule();

    await world.createIncidentChannels();
    await world.page(ON_CALL);

    // A manager acknowledges from OneUptime, and so becomes the commander.
    await world.assignCommander(COMMANDER);

    expect(world.slackUsersInvitedTo(incidentChannelId())).toEqual([
      "U0ONCALL",
      "U0CMDR",
    ]);
  });

  test("the commander's invite is logged on the incident's Notification Logs", async () => {
    customersRule();

    await world.createIncidentChannels();
    await world.assignCommander(COMMANDER);

    const invites: Array<WorkspaceNotificationLog> = world.logRowsOf(
      WorkspaceNotificationActionType.InviteUser,
    );

    expect(invites).toHaveLength(1);
    expect(invites[0]!.userId?.toString()).toBe(COMMANDER.toString());
    expect(invites[0]!.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(invites[0]!.channelName).toBe("inc-42");
  });

  test("a commander who was the person paged is not invited twice", async () => {
    customersRule();

    await world.createIncidentChannels();
    await world.page(ON_CALL);
    await world.assignCommander(ON_CALL);

    // Slack is asked who is in the channel, and nobody is invited again.
    expect(world.slackUsersInvitedTo(incidentChannelId())).toEqual([
      "U0ONCALL",
    ]);
  });
});

describe("the commander is assigned when the incident is acknowledged", () => {
  /*
   * Whoever first changes an incident's state becomes its commander, when
   * it has none (IncidentStateTimelineService.autoAssignIncidentCommander).
   * The member row is stored, and its hook invites them.
   */
  test("REGRESSION: the commander auto-assigned by acknowledging joins the customer's channel", async () => {
    customersRule();
    await world.createIncidentChannels();

    const primaryRole: IncidentRole = new IncidentRole();
    primaryRole.id = COMMANDER_ROLE_ID;
    jest
      .spyOn(IncidentRoleService, "findOneBy")
      .mockResolvedValue(primaryRole as never);
    // No commander yet, and the person is not on the incident in any role.
    jest.spyOn(IncidentMemberService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockResolvedValue(true);

    // The member row is stored, then its hook runs, as create does.
    const createdMembers: Array<IncidentMember> = [];
    jest.spyOn(IncidentMemberService, "create").mockImplementation((async (data: {
      data: IncidentMember;
    }): Promise<IncidentMember> => {
      createdMembers.push(data.data);
      world.incidentMembers.push(data.data.userId!);
      await IncidentMemberService.onCreateSuccess(
        {
          createBy: { data: data.data, props: { isRoot: true } },
          carryForward: null,
        },
        data.data,
      );
      return data.data;
    }) as never);

    await (
      IncidentStateTimelineService as unknown as {
        autoAssignIncidentCommander: (data: {
          incidentId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
        }) => Promise<void>;
      }
    ).autoAssignIncidentCommander({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      userId: COMMANDER,
    });
    await world.settle();

    expect(createdMembers).toHaveLength(1);
    expect(createdMembers[0]!.incidentRoleId?.toString()).toBe(
      COMMANDER_ROLE_ID.toString(),
    );
    expect(world.slackUsersInvitedTo(incidentChannelId())).toEqual([
      "U0CMDR",
    ]);
  });
});

describe("the rule's own switch for incident roles", () => {
  test("off: the commander is not invited, the person paged still is", async () => {
    customersRule({ inviteRoles: false });

    await world.createIncidentChannels();
    await world.page(ON_CALL);
    await world.assignCommander(COMMANDER);

    expect(world.slackUsersInvitedTo(incidentChannelId())).toEqual([
      "U0ONCALL",
    ]);
  });

  test("on, with owners and on-call responders off: only the commander joins", async () => {
    world.rules = [
      makeRule({ inviteOnCall: false, inviteOwners: false, inviteRoles: true }),
    ];

    await world.createIncidentChannels();
    await world.page(ON_CALL);
    await world.assignCommander(COMMANDER);

    expect(world.slackUsersInvitedTo(incidentChannelId())).toEqual([
      "U0CMDR",
    ]);
  });

  test("a rule that adds nobody of the incident's, and does not say about roles, does not add the commander", async () => {
    world.rules = [makeRule({ inviteOnCall: false, inviteOwners: false })];

    await world.createIncidentChannels();
    await world.assignCommander(COMMANDER);

    expect(world.slackInvites()).toEqual([]);
  });

  test("a rule that adds the owners, and does not say about roles, adds the commander, as it always did", async () => {
    world.rules = [makeRule({ inviteOnCall: false, inviteOwners: true })];

    await world.createIncidentChannels();
    await world.assignCommander(COMMANDER);

    expect(world.slackUsersInvitedTo(incidentChannelId())).toEqual([
      "U0CMDR",
    ]);
  });
});

describe("whose channel the commander joins", () => {
  /*
   * The channel is its rule's from the moment it is created: someone who
   * joins the incident later joins it, whatever the incident's conditions
   * say by then.
   */
  test("the channel of a rule for Critical incidents, after the severity was lowered", async () => {
    world.rules = [
      makeRule({
        inviteRoles: true,
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
            conditionType: ConditionType.ContainsAny,
            value: [CRITICAL_SEVERITY_ID.toString()],
          },
        ],
      }),
    ];

    await world.createIncidentChannels();
    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);

    world.incident.severityId = MINOR_SEVERITY_ID;
    await world.assignCommander(COMMANDER);

    expect(world.slackUsersInvitedTo(incidentChannelId())).toEqual([
      "U0CMDR",
    ]);
  });

  test("not the channel of another rule: only the rules that created one of the incident's channels count", async () => {
    // OTHER_RULE_ID adds roles but created no channel of this incident.
    world.rules = [
      makeRule({ inviteRoles: false }),
      makeRule({
        id: OTHER_RULE_ID,
        createsChannel: false,
        existingChannels: "#ops",
        inviteRoles: true,
      }),
    ];

    await world.createIncidentChannels();
    await world.assignCommander(COMMANDER);

    expect(world.slackInvites()).toEqual([]);
  });

  test("both rules' channels when both created one and add roles", async () => {
    world.rules = [
      makeRule({ inviteRoles: true }),
      makeRule({ id: OTHER_RULE_ID, prefix: "war-", inviteRoles: true }),
    ];

    await world.createIncidentChannels();
    expect(world.slackChannelsCreated()).toEqual(["inc-42", "war-inc-42"]);

    await world.assignCommander(COMMANDER);

    const channelIds: Array<string> = (world.incident.channels || []).map(
      (channel: { id: string }): string => {
        return channel.id;
      },
    );
    expect(channelIds).toHaveLength(2);

    for (const channelId of channelIds) {
      expect(world.slackUsersInvitedTo(channelId)).toEqual(["U0CMDR"]);
    }
  });
});

describe("who cannot join", () => {
  test("a commander who left the project is not invited", async () => {
    customersRule();
    world.projectMembers.delete(LEFT_PROJECT.toString());

    await world.createIncidentChannels();
    await world.assignCommander(LEFT_PROJECT);

    expect(world.slackInvites()).toEqual([]);
  });

  test("a commander without a connected Slack account is named in the channel's note instead", async () => {
    customersRule();

    await world.createIncidentChannels();
    await world.assignCommander(NOT_CONNECTED);

    expect(world.slackInvites()).toEqual([]);
    expect(
      world.notesOfMembersNotAdded.map(
        (note: { userIds: Array<ObjectID> }): Array<string> => {
          return note.userIds.map((userId: ObjectID): string => {
            return userId.toString();
          });
        },
      ),
    ).toEqual([[NOT_CONNECTED.toString()]]);
  });

  test("Microsoft Teams: the channel is created in the team, and nobody is invited one by one", async () => {
    world.connected = [WorkspaceType.MicrosoftTeams];
    world.rules = [
      makeRule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        inviteOnCall: true,
        teamToCreateChannelIn: TEAMS_TEAM_ID,
      }),
    ];

    await world.createIncidentChannels();
    await world.assignCommander(COMMANDER);

    expect(world.graphCreates).toEqual([
      {
        teamId: TEAMS_TEAM_ID,
        displayName: "inc-42",
        membershipType: "standard",
      },
    ]);
    // Microsoft Teams shows a team's channels to its members.
    expect(world.slackRequests).toEqual([]);
  });
});

describe("an incident episode's roles", () => {
  /*
   * Somebody given a role on an episode joins the episode's own channels
   * whose rules add the people given a role, as an incident's commander
   * joins the incident's.
   */
  test("the person given a role on the episode joins the episode's channel", async () => {
    world.rules = [
      makeRule({
        eventType: NotificationRuleEventType.IncidentEpisode,
        inviteRoles: true,
      }),
    ];
    world.incidentEpisode.channels = [
      {
        id: "C0EP3",
        name: "ie-3",
        workspaceType: WorkspaceType.Slack,
        notificationRuleId: RULE_ID.toString(),
      },
    ];
    world.addSlackChannel({ id: "C0EP3", name: "ie-3" });

    // The role is copied onto the episode's incidents: none here.
    jest
      .spyOn(IncidentEpisodeMemberService, "findBy")
      .mockResolvedValue([] as Array<IncidentEpisodeMember>);

    const roleMember: IncidentEpisodeRoleMember =
      new IncidentEpisodeRoleMember();
    roleMember.projectId = PROJECT_ID;
    roleMember.incidentEpisodeId = INCIDENT_EPISODE_ID;
    roleMember.userId = COMMANDER;
    roleMember.incidentRoleId = COMMANDER_ROLE_ID;

    await IncidentEpisodeRoleMemberService.onCreateSuccess(
      {
        createBy: { data: roleMember, props: { isRoot: true } },
        carryForward: null,
      },
      roleMember,
    );
    await world.settle();

    expect(world.slackUsersInvitedTo("C0EP3")).toEqual(["U0CMDR"]);

    const invites: Array<WorkspaceNotificationLog> = world.logRowsOf(
      WorkspaceNotificationActionType.InviteUser,
    );
    expect(invites[0]!.incidentEpisodeId?.toString()).toBe(
      INCIDENT_EPISODE_ID.toString(),
    );
  });

  test("not when the episode's rule does not add roles", async () => {
    world.rules = [
      makeRule({
        eventType: NotificationRuleEventType.IncidentEpisode,
        inviteRoles: false,
      }),
    ];
    world.incidentEpisode.channels = [
      {
        id: "C0EP3",
        name: "ie-3",
        workspaceType: WorkspaceType.Slack,
        notificationRuleId: RULE_ID.toString(),
      },
    ];

    jest
      .spyOn(IncidentEpisodeMemberService, "findBy")
      .mockResolvedValue([] as Array<IncidentEpisodeMember>);

    const roleMember: IncidentEpisodeRoleMember =
      new IncidentEpisodeRoleMember();
    roleMember.projectId = PROJECT_ID;
    roleMember.incidentEpisodeId = INCIDENT_EPISODE_ID;
    roleMember.userId = COMMANDER;
    roleMember.incidentRoleId = COMMANDER_ROLE_ID;

    await IncidentEpisodeRoleMemberService.onCreateSuccess(
      {
        createBy: { data: roleMember, props: { isRoot: true } },
        carryForward: null,
      },
      roleMember,
    );
    await world.settle();

    expect(world.slackInvites()).toEqual([]);
  });
});
