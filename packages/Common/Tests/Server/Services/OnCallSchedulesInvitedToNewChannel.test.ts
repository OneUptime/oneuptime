import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import { ChannelMembersNotAdded } from "../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * WHOEVER IS ON CALL IN A RULE'S SCHEDULES JOINS ITS NEW CHANNEL, UNPAGED.
 *
 * A customer keeps "@payments-oncall" in Slack and wanted the people on call
 * brought into an incident's channel - conditionally, by the rule's
 * conditions - without paging them. A rule that creates a channel can now
 * name on-call schedules: Slack adds whoever is on call in them with the
 * rule's other people; Microsoft Teams adds nobody to a channel, so they are
 * handed back to be @mentioned in it once the record's first message is
 * posted (MicrosoftTeamsOnCallMention).
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

const PRIMARY: ObjectID = ObjectID.generate();
const SECONDARY: ObjectID = ObjectID.generate();
const DATABASE: ObjectID = ObjectID.generate();

const JANE: ObjectID = ObjectID.generate();
const RAJ: ObjectID = ObjectID.generate();
const ALEX: ObjectID = ObjectID.generate();
const NAMED_ON_RULE: ObjectID = ObjectID.generate();

// Who has a Slack or Teams account connected, by OneUptime user.
const CONNECTED: Map<string, string> = new Map<string, string>([
  [JANE.toString(), "U0JANE"],
  [NAMED_ON_RULE.toString(), "U0NAMED"],
]);

let members: Set<string>;
let invite: Mock<(data: unknown) => Promise<void>>;
let scheduleFindBy: SpyInstance<typeof OnCallDutyPolicyScheduleService.findBy>;
let inviteLog: SpyInstance<
  typeof WorkspaceNotificationLogService.logInviteUser
>;

function schedule(
  id: ObjectID,
  name: string,
  onCall: ObjectID | null,
): OnCallDutyPolicySchedule {
  const model: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  model.id = id;
  model.name = name;

  if (onCall) {
    model.currentUserIdOnRoster = onCall;
  }

  return model;
}

function rule(data: {
  workspaceType: WorkspaceType;
  schedules: Array<ObjectID>;
  users?: Array<ObjectID> | undefined;
}): WorkspaceNotificationRule {
  const model: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  model.id = ObjectID.generate();
  model.projectId = PROJECT_ID;
  model.workspaceType = data.workspaceType;
  model.eventType = NotificationRuleEventType.Incident;

  const notificationRule: IncidentNotificationRule = {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: true,
    inviteUsersToNewChannel: data.users || [],
    inviteTeamsToNewChannel: [],
    // As the Dashboard saves them: ids as text.
    inviteOnCallSchedulesToNewChannel: data.schedules.map(
      (id: ObjectID): string => {
        return id.toString();
      },
    ) as unknown as Array<ObjectID>,
    shouldInviteOwnersToNewChannel: false,
    shouldInviteIncidentRolesToNewChannel: false,
    archiveChannelAutomatically: false,
    shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
  };

  model.notificationRule = notificationRule as never;
  return model;
}

function channel(data: {
  id: string;
  name: string;
  workspaceType: WorkspaceType;
  rules: Array<WorkspaceNotificationRule>;
  teamId?: string | undefined;
}): NotificationRuleWorkspaceChannel {
  return {
    id: data.id,
    name: data.name,
    workspaceType: data.workspaceType,
    notificationRuleId: data.rules[0]!.id!.toString(),
    notificationRuleIds: data.rules.map(
      (model: WorkspaceNotificationRule): string => {
        return model.id!.toString();
      },
    ),
    ...(data.teamId ? { teamId: data.teamId } : {}),
  };
}

async function setUpChannels(data: {
  workspaceType: WorkspaceType;
  rules: Array<WorkspaceNotificationRule>;
  channels: Array<NotificationRuleWorkspaceChannel>;
  notificationFor?: NotificationFor | undefined;
}): Promise<Array<ChannelMembersNotAdded>> {
  const projectAuth: WorkspaceProjectAuthToken =
    new WorkspaceProjectAuthToken();
  projectAuth.authToken = "project-token";

  return await WorkspaceNotificationRuleService.inviteUsersAndTeamsToChannelsBasedOnRules(
    {
      projectId: PROJECT_ID,
      projectAuth: projectAuth,
      workspaceType: data.workspaceType,
      notificationRules: data.rules,
      notificationChannels: data.channels,
      notificationFor: data.notificationFor,
    },
  );
}

function invitedWorkspaceUserIds(): Array<Array<string>> {
  return invite.mock.calls.map((call: Array<unknown>): Array<string> => {
    return (
      call[0] as {
        workspaceChannelInvitationPayload: { workspaceUserIds: Array<string> };
      }
    ).workspaceChannelInvitationPayload.workspaceUserIds;
  });
}

beforeEach(() => {
  members = new Set<string>([
    JANE.toString(),
    RAJ.toString(),
    NAMED_ON_RULE.toString(),
  ]);

  // Only members of the project are invited or mentioned, in the order asked.
  jest
    .spyOn(TeamMemberService, "getProjectMemberUserIds")
    .mockImplementation(
      async (data: {
        userIds: Array<ObjectID | string>;
      }): Promise<Array<ObjectID>> => {
        return data.userIds
          .filter((userId: ObjectID | string): boolean => {
            return members.has(userId.toString());
          })
          .map((userId: ObjectID | string): ObjectID => {
            return new ObjectID(userId.toString());
          });
      },
    );

  scheduleFindBy = jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockResolvedValue([
      schedule(PRIMARY, "Payments Primary", JANE),
      schedule(SECONDARY, "Payments Secondary", RAJ),
      schedule(DATABASE, "Database", JANE),
    ]);

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getWorkspaceUserIdFromOneUptimeUserId",
    )
    .mockImplementation(
      async (data: { oneuptimeUserId: ObjectID }): Promise<string | null> => {
        return CONNECTED.get(data.oneuptimeUserId.toString()) || null;
      },
    );

  invite = jest.fn(async (): Promise<void> => {
    return undefined;
  });

  jest.spyOn(WorkspaceUtil, "getWorkspaceTypeUtil").mockReturnValue({
    inviteUsersToChannels: invite,
  } as never);

  inviteLog = jest
    .spyOn(WorkspaceNotificationLogService, "logInviteUser")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Slack: whoever is on call in the rule's schedules is added to its channel", () => {
  test("the people on call join with the rule's other people, in one invite, and are logged as invited against the record", async () => {
    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.Slack,
      schedules: [PRIMARY],
      users: [NAMED_ON_RULE],
    });

    const incidentId: ObjectID = ObjectID.generate();

    await setUpChannels({
      workspaceType: WorkspaceType.Slack,
      rules: [payments],
      channels: [
        channel({
          id: "C0INC42",
          name: "inc-42",
          workspaceType: WorkspaceType.Slack,
          rules: [payments],
        }),
      ],
      notificationFor: { incidentId: incidentId },
    });

    expect(invitedWorkspaceUserIds()).toEqual([["U0NAMED", "U0JANE"]]);

    const logged: Array<string> = inviteLog.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { userId: ObjectID }).userId.toString();
      },
    );

    expect(logged).toEqual([NAMED_ON_RULE.toString(), JANE.toString()]);
    expect(inviteLog.mock.calls[1]![0]).toMatchObject({
      incidentId: incidentId,
      channelId: "C0INC42",
    });
  });

  test("somebody on call in two schedules is invited once", async () => {
    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.Slack,
      schedules: [PRIMARY, DATABASE],
    });

    await setUpChannels({
      workspaceType: WorkspaceType.Slack,
      rules: [payments],
      channels: [
        channel({
          id: "C0INC42",
          name: "inc-42",
          workspaceType: WorkspaceType.Slack,
          rules: [payments],
        }),
      ],
    });

    expect(invitedWorkspaceUserIds()).toEqual([["U0JANE"]]);
  });

  test("somebody on call without a connected Slack account is named in the channel's note, as anybody else the rule adds", async () => {
    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.Slack,
      schedules: [PRIMARY, SECONDARY],
    });

    const membersNotAdded: Array<ChannelMembersNotAdded> = await setUpChannels({
      workspaceType: WorkspaceType.Slack,
      rules: [payments],
      channels: [
        channel({
          id: "C0INC42",
          name: "inc-42",
          workspaceType: WorkspaceType.Slack,
          rules: [payments],
        }),
      ],
    });

    expect(invitedWorkspaceUserIds()).toEqual([["U0JANE"]]);
    expect(membersNotAdded).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        channels: [{ id: "C0INC42", name: "inc-42" }],
        userIds: [RAJ],
      },
    ]);
  });

  test("somebody on call who is not a member of the project is not invited", async () => {
    members.delete(JANE.toString());

    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.Slack,
      schedules: [PRIMARY],
    });

    const membersNotAdded: Array<ChannelMembersNotAdded> = await setUpChannels({
      workspaceType: WorkspaceType.Slack,
      rules: [payments],
      channels: [
        channel({
          id: "C0INC42",
          name: "inc-42",
          workspaceType: WorkspaceType.Slack,
          rules: [payments],
        }),
      ],
    });

    expect(invite).not.toHaveBeenCalled();
    expect(membersNotAdded).toEqual([]);
  });

  test("schedules that cannot be read add nobody, and the rule's other people are still invited", async () => {
    scheduleFindBy.mockRejectedValue(new Error("database is away"));

    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.Slack,
      schedules: [PRIMARY],
      users: [NAMED_ON_RULE],
    });

    await setUpChannels({
      workspaceType: WorkspaceType.Slack,
      rules: [payments],
      channels: [
        channel({
          id: "C0INC42",
          name: "inc-42",
          workspaceType: WorkspaceType.Slack,
          rules: [payments],
        }),
      ],
    });

    expect(invitedWorkspaceUserIds()).toEqual([["U0NAMED"]]);
  });

  test("a second rule that shares the channel - conditions of its own, schedules of its own - adds its people on call to it", async () => {
    const everyIncident: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.Slack,
      schedules: [],
      users: [NAMED_ON_RULE],
    });
    const databaseIncidents: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.Slack,
      schedules: [DATABASE],
    });

    await setUpChannels({
      workspaceType: WorkspaceType.Slack,
      rules: [everyIncident, databaseIncidents],
      channels: [
        channel({
          id: "C0INC42",
          name: "inc-42",
          workspaceType: WorkspaceType.Slack,
          rules: [everyIncident, databaseIncidents],
        }),
      ],
    });

    expect(invitedWorkspaceUserIds()).toEqual([["U0NAMED"], ["U0JANE"]]);

    for (const call of invite.mock.calls) {
      expect(call[0]).toMatchObject({
        workspaceChannelInvitationPayload: { channelNames: ["inc-42"] },
      });
    }
  });

  test("REGRESSION: a rule saved before schedules could be named reads no schedule", async () => {
    const saved: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.Slack,
      schedules: [],
      users: [NAMED_ON_RULE],
    });

    delete (saved.notificationRule as unknown as Record<string, unknown>)[
      "inviteOnCallSchedulesToNewChannel"
    ];

    await setUpChannels({
      workspaceType: WorkspaceType.Slack,
      rules: [saved],
      channels: [
        channel({
          id: "C0INC42",
          name: "inc-42",
          workspaceType: WorkspaceType.Slack,
          rules: [saved],
        }),
      ],
    });

    expect(scheduleFindBy).not.toHaveBeenCalled();
    expect(invitedWorkspaceUserIds()).toEqual([["U0NAMED"]]);
  });
});

describe("Microsoft Teams: whoever is on call is handed back to be @mentioned in the channel", () => {
  test("nobody is added through Teams; each channel hands back its people on call, with its team and the record, for after the record's first message", async () => {
    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      schedules: [PRIMARY, SECONDARY],
    });

    const incidentId: ObjectID = ObjectID.generate();

    const membersNotAdded: Array<ChannelMembersNotAdded> = await setUpChannels({
      workspaceType: WorkspaceType.MicrosoftTeams,
      rules: [payments],
      channels: [
        channel({
          id: "19:inc42@thread.tacv2",
          name: "inc-42",
          workspaceType: WorkspaceType.MicrosoftTeams,
          rules: [payments],
          teamId: "graph-team-1",
        }),
      ],
      notificationFor: { incidentId: incidentId },
    });

    expect(invite).not.toHaveBeenCalled();
    expect(inviteLog).not.toHaveBeenCalled();

    expect(membersNotAdded).toEqual([
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        channels: [
          {
            id: "19:inc42@thread.tacv2",
            name: "inc-42",
            teamId: "graph-team-1",
          },
        ],
        userIds: [],
        onCallToMention: [
          { userId: JANE, scheduleNames: ["Payments Primary"] },
          { userId: RAJ, scheduleNames: ["Payments Secondary"] },
        ],
        notificationFor: { incidentId: incidentId },
      },
    ]);
  });

  test("two rules sharing a channel get one mention there, each person once with every schedule they are on call in", async () => {
    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      schedules: [PRIMARY],
    });
    const database: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      schedules: [DATABASE, SECONDARY],
    });

    const membersNotAdded: Array<ChannelMembersNotAdded> = await setUpChannels({
      workspaceType: WorkspaceType.MicrosoftTeams,
      rules: [payments, database],
      channels: [
        channel({
          id: "19:inc42@thread.tacv2",
          name: "inc-42",
          workspaceType: WorkspaceType.MicrosoftTeams,
          rules: [payments, database],
          teamId: "graph-team-1",
        }),
      ],
    });

    expect(membersNotAdded).toHaveLength(1);
    expect(membersNotAdded[0]!.onCallToMention).toEqual([
      { userId: JANE, scheduleNames: ["Payments Primary", "Database"] },
      { userId: RAJ, scheduleNames: ["Payments Secondary"] },
    ]);
  });

  test("each rule's own channel mentions only its own schedules' people", async () => {
    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      schedules: [PRIMARY],
    });
    const database: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      schedules: [SECONDARY],
    });

    const membersNotAdded: Array<ChannelMembersNotAdded> = await setUpChannels({
      workspaceType: WorkspaceType.MicrosoftTeams,
      rules: [payments, database],
      channels: [
        channel({
          id: "19:pay@thread.tacv2",
          name: "pay-inc-42",
          workspaceType: WorkspaceType.MicrosoftTeams,
          rules: [payments],
          teamId: "graph-team-1",
        }),
        channel({
          id: "19:db@thread.tacv2",
          name: "db-inc-42",
          workspaceType: WorkspaceType.MicrosoftTeams,
          rules: [database],
          teamId: "graph-team-2",
        }),
      ],
    });

    expect(
      membersNotAdded.map((entry: ChannelMembersNotAdded) => {
        return {
          channelId: entry.channels[0]!.id,
          teamId: entry.channels[0]!.teamId,
          people: (entry.onCallToMention || []).map(
            (person: { userId: ObjectID }): string => {
              return person.userId.toString();
            },
          ),
        };
      }),
    ).toEqual([
      {
        channelId: "19:pay@thread.tacv2",
        teamId: "graph-team-1",
        people: [JANE.toString()],
      },
      {
        channelId: "19:db@thread.tacv2",
        teamId: "graph-team-2",
        people: [RAJ.toString()],
      },
    ]);
  });

  test("somebody on call who is not a member of the project is not mentioned", async () => {
    members.delete(RAJ.toString());

    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      schedules: [PRIMARY, SECONDARY],
    });

    const membersNotAdded: Array<ChannelMembersNotAdded> = await setUpChannels({
      workspaceType: WorkspaceType.MicrosoftTeams,
      rules: [payments],
      channels: [
        channel({
          id: "19:inc42@thread.tacv2",
          name: "inc-42",
          workspaceType: WorkspaceType.MicrosoftTeams,
          rules: [payments],
          teamId: "graph-team-1",
        }),
      ],
    });

    expect(membersNotAdded[0]!.onCallToMention).toEqual([
      { userId: JANE, scheduleNames: ["Payments Primary"] },
    ]);
  });

  test("nobody on call in the rule's schedules: nothing is handed back", async () => {
    scheduleFindBy.mockResolvedValue([
      schedule(PRIMARY, "Payments Primary", null),
    ]);

    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      schedules: [PRIMARY],
    });

    const membersNotAdded: Array<ChannelMembersNotAdded> = await setUpChannels({
      workspaceType: WorkspaceType.MicrosoftTeams,
      rules: [payments],
      channels: [
        channel({
          id: "19:inc42@thread.tacv2",
          name: "inc-42",
          workspaceType: WorkspaceType.MicrosoftTeams,
          rules: [payments],
          teamId: "graph-team-1",
        }),
      ],
    });

    expect(membersNotAdded).toEqual([]);
  });

  test("somebody on call in a schedule the rule does not name is never mentioned", async () => {
    scheduleFindBy.mockResolvedValue([
      schedule(PRIMARY, "Payments Primary", JANE),
      schedule(ObjectID.generate(), "Other", ALEX),
    ]);

    const payments: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      schedules: [PRIMARY],
    });

    const membersNotAdded: Array<ChannelMembersNotAdded> = await setUpChannels({
      workspaceType: WorkspaceType.MicrosoftTeams,
      rules: [payments],
      channels: [
        channel({
          id: "19:inc42@thread.tacv2",
          name: "inc-42",
          workspaceType: WorkspaceType.MicrosoftTeams,
          rules: [payments],
          teamId: "graph-team-1",
        }),
      ],
    });

    expect(
      (membersNotAdded[0]!.onCallToMention || []).map(
        (person: { userId: ObjectID }): string => {
          return person.userId.toString();
        },
      ),
    ).toEqual([JANE.toString()]);
  });
});
