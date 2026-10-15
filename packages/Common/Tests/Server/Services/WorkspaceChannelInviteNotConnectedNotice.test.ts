import User from "../../../Models/DatabaseModels/User";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import ChannelMembersNotAddedNotice, {
  ChannelMembersNotAdded,
} from "../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
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
 * WHO COULD NOT BE ADDED TO A CHANNEL IS SAID ONCE, FOR EVERYBODY AT ONCE.
 *
 * Adding people to a channel OneUptime created - at creation, as owners are
 * added, as an on-call rule pages them - used to post "<person> cannot be
 * invited to the channel because the account is not connected to Slack"
 * for each person, every time. Both invite paths now invite everybody
 * connected in one call and hand everybody else to ChannelMembersNotAddedNotice
 * once, which keeps one note per channel. An invite Slack refuses no longer
 * ends the channel's setup.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RULE_ID: ObjectID = ObjectID.generate();
const OTHER_RULE_ID: ObjectID = ObjectID.generate();
const CONNECTED: ObjectID = ObjectID.generate();
const NOT_CONNECTED_1: ObjectID = ObjectID.generate();
const NOT_CONNECTED_2: ObjectID = ObjectID.generate();

const RULE_CHANNEL: NotificationRuleWorkspaceChannel = {
  id: "C0INC8",
  name: "inc-inc-8",
  workspaceType: WorkspaceType.Slack,
  notificationRuleId: RULE_ID.toString(),
};

const OTHER_RULE_CHANNEL: NotificationRuleWorkspaceChannel = {
  id: "C0OTHER",
  name: "other-inc-8",
  workspaceType: WorkspaceType.Slack,
  notificationRuleId: OTHER_RULE_ID.toString(),
};

type RecordField = keyof NotificationFor;

// Every kind of record OneUptime creates channels for and invites people to.
const RECORD_FIELDS: Array<{ field: RecordField }> = [
  { field: "incidentId" },
  { field: "alertId" },
  { field: "scheduledMaintenanceId" },
  { field: "onCallDutyPolicyId" },
  { field: "monitorId" },
  { field: "incidentEpisodeId" },
  { field: "alertEpisodeId" },
];

function rule(
  id: ObjectID,
  workspaceType: WorkspaceType,
): WorkspaceNotificationRule {
  const model: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  model.id = id;
  model.workspaceType = workspaceType;
  return model;
}

function user(id: ObjectID): User {
  const model: User = new User();
  model.id = id;
  return model;
}

let invite: Mock<(data: unknown) => Promise<void>>;
let sendMessage: Mock<(data: unknown) => Promise<void>>;
let noticeSpy: SpyInstance<
  typeof ChannelMembersNotAddedNotice.noteMembersNotAdded
>;
let inviteLogSpy: SpyInstance<
  typeof WorkspaceNotificationLogService.logInviteUser
>;

beforeEach(() => {
  jest
    .spyOn(ProjectMembership, "getMemberUserIds")
    .mockImplementation(
      async (data: {
        userIds: Array<ObjectID | string>;
      }): Promise<Set<string>> => {
        return new Set<string>(
          data.userIds.map((userId: ObjectID | string): string => {
            return userId.toString();
          }),
        );
      },
    );

  jest.spyOn(WorkspaceProjectAuthTokenService, "findOneBy").mockResolvedValue({
    authToken: "xoxb-project",
    workspaceProjectId: "T0001",
  } as unknown as WorkspaceProjectAuthToken);

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getWorkspaceUserIdFromOneUptimeUserId",
    )
    .mockImplementation(
      async (data: { oneuptimeUserId: ObjectID }): Promise<string | null> => {
        return data.oneuptimeUserId.toString() === CONNECTED.toString()
          ? "U0CONNECTED"
          : null;
      },
    );

  invite = jest.fn(async (): Promise<void> => {
    return undefined;
  });
  sendMessage = jest.fn(async (): Promise<void> => {
    return undefined;
  });

  jest.spyOn(WorkspaceUtil, "getWorkspaceTypeUtil").mockReturnValue({
    inviteUsersToChannels: invite,
    sendMessage: sendMessage,
  } as never);

  noticeSpy = jest
    .spyOn(ChannelMembersNotAddedNotice, "noteMembersNotAdded")
    .mockResolvedValue(undefined);

  inviteLogSpy = jest
    .spyOn(WorkspaceNotificationLogService, "logInviteUser")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("inviteUsersBasedOnRulesAndWorkspaceChannels (owners, paged on-call people)", () => {
  async function inviteThree(): Promise<void> {
    await WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        projectId: PROJECT_ID,
        notificationRules: [rule(RULE_ID, WorkspaceType.Slack)],
        workspaceChannels: [RULE_CHANNEL],
        userIds: [CONNECTED, NOT_CONNECTED_1, NOT_CONNECTED_2],
      },
    );
  }

  test("the connected person is invited; the others are named once, in the channel's one note - no message per person", async () => {
    await inviteThree();

    expect(invite).toHaveBeenCalledTimes(1);
    expect(invite.mock.calls[0]![0]).toMatchObject({
      workspaceChannelInvitationPayload: {
        channelNames: ["inc-inc-8"],
        workspaceUserIds: ["U0CONNECTED"],
      },
    });

    // REGRESSION: "<person> cannot be invited to the channel ..." per person.
    expect(sendMessage).not.toHaveBeenCalled();

    expect(noticeSpy).toHaveBeenCalledTimes(1);
    expect(noticeSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      channels: [{ id: "C0INC8", name: "inc-inc-8" }],
      userIds: [NOT_CONNECTED_1, NOT_CONNECTED_2],
    });
  });

  test("only the people who were invited are logged as invited", async () => {
    await inviteThree();

    expect(inviteLogSpy).toHaveBeenCalledTimes(1);
    expect(
      (
        inviteLogSpy.mock.calls[0]![0] as { userId: ObjectID }
      ).userId.toString(),
    ).toBe(CONNECTED.toString());
  });

  test("an invite Slack refuses still lets the channel be told who could not be added, and logs nobody as invited", async () => {
    invite.mockRejectedValueOnce(new Error("Error from Slack is_archived"));

    await expect(inviteThree()).resolves.toBeUndefined();

    expect(noticeSpy).toHaveBeenCalledTimes(1);
    expect(inviteLogSpy).not.toHaveBeenCalled();
  });

  /*
   * The record the channels belong to, when the caller names it, is on the
   * invite's log row: a record's Notification Logs page lists its
   * workspace logs by its id, so an on-call page's or an owner's invite is
   * listed there beside the channel's creation and messages.
   */
  test.each(RECORD_FIELDS)(
    "the invite is logged against the record the channels belong to: $field",
    async (data: { field: RecordField }) => {
      const recordId: ObjectID = ObjectID.generate();

      await WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
        {
          projectId: PROJECT_ID,
          notificationRules: [rule(RULE_ID, WorkspaceType.Slack)],
          workspaceChannels: [RULE_CHANNEL],
          userIds: [CONNECTED],
          notificationFor: { [data.field]: recordId },
        },
      );

      expect(inviteLogSpy).toHaveBeenCalledTimes(1);
      expect(inviteLogSpy.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        channelId: "C0INC8",
        channelName: "inc-inc-8",
        userId: CONNECTED,
        [data.field]: recordId,
      });
    },
  );

  test("no record named (an owner added): the invite's log row names none, as before", async () => {
    await inviteThree();

    expect(inviteLogSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      channelId: "C0INC8",
      channelName: "inc-inc-8",
      userId: CONNECTED,
    });
  });

  /*
   * A rule's test invites the person testing to the channel it creates, and
   * says so when the workspace refuses: "Cannot invite users to the channel.
   * Error from Slack missing_scope". Once invite refusals were only logged
   * here, the test reported success with the tester never added.
   */
  test("REGRESSION: asked to, it throws what the workspace answered when it refuses an invite", async () => {
    invite.mockRejectedValueOnce(new Error("Error from Slack missing_scope"));

    await expect(
      WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
        {
          projectId: PROJECT_ID,
          notificationRules: [rule(RULE_ID, WorkspaceType.Slack)],
          workspaceChannels: [RULE_CHANNEL],
          userIds: [CONNECTED],
          throwOnInviteError: true,
        },
      ),
    ).rejects.toThrow("Error from Slack missing_scope");

    expect(inviteLogSpy).not.toHaveBeenCalled();
  });
});

describe("inviteTeamsBasedOnRulesAndWorkspaceChannels (owner teams)", () => {
  /*
   * A team made an owner of a record is invited as its people, through the
   * path above: the record it is the owner of goes with them, so the
   * invites are listed on the record's Notification Logs page.
   */
  test.each(RECORD_FIELDS)(
    "the team's people who were invited are logged against the record the channels belong to: $field",
    async (data: { field: RecordField }) => {
      const recordId: ObjectID = ObjectID.generate();

      jest
        .spyOn(TeamMemberService, "getUsersInTeams")
        .mockResolvedValue([user(CONNECTED), user(NOT_CONNECTED_1)]);

      await WorkspaceNotificationRuleService.inviteTeamsBasedOnRulesAndWorkspaceChannels(
        {
          projectId: PROJECT_ID,
          notificationRules: [rule(RULE_ID, WorkspaceType.Slack)],
          workspaceChannels: [RULE_CHANNEL],
          teamIds: [ObjectID.generate()],
          notificationFor: { [data.field]: recordId },
        },
      );

      expect(invite).toHaveBeenCalledTimes(1);
      expect(inviteLogSpy).toHaveBeenCalledTimes(1);
      expect(inviteLogSpy.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        channelId: "C0INC8",
        channelName: "inc-inc-8",
        userId: CONNECTED,
        [data.field]: recordId,
      });
    },
  );
});

/*
 * A channel just created: the people who could not be added are handed back,
 * not told yet - the record's service tells the channel right after the
 * record's own first message ("Incident INC-8 Created"), so the channel
 * opens on what happened (NewChannelNoteFollowsCreatedMessage.test.ts).
 */
describe("inviteUsersAndTeamsToChannelsBasedOnRules (a channel just created)", () => {
  async function createChannels(
    options: {
      workspaceType?: WorkspaceType;
      // The record the channels are created for.
      notificationFor?: NotificationFor;
      channels?: Array<NotificationRuleWorkspaceChannel>;
    } = {},
  ): Promise<Array<ChannelMembersNotAdded>> {
    const workspaceType: WorkspaceType =
      options.workspaceType || WorkspaceType.Slack;

    jest
      .spyOn(WorkspaceNotificationRuleService, "getUsersIdsToInviteToChannel")
      .mockResolvedValue([
        {
          notificationRuleId: RULE_ID.toString(),
          userIds: [CONNECTED, NOT_CONNECTED_1, NOT_CONNECTED_2],
        },
      ]);

    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.authToken = "xoxb-project";
    projectAuth.workspaceProjectId = "T0001";

    return await WorkspaceNotificationRuleService.inviteUsersAndTeamsToChannelsBasedOnRules(
      {
        projectId: PROJECT_ID,
        projectAuth: projectAuth,
        workspaceType: workspaceType,
        notificationRules: [rule(RULE_ID, workspaceType)],
        notificationChannels: options.channels || [
          RULE_CHANNEL,
          OTHER_RULE_CHANNEL,
        ],
        notificationFor: options.notificationFor,
      },
    );
  }

  test("REGRESSION: everybody connected is invited in ONE call, not once per person", async () => {
    await createChannels();

    expect(invite).toHaveBeenCalledTimes(1);
    expect(invite.mock.calls[0]![0]).toMatchObject({
      workspaceChannelInvitationPayload: {
        channelNames: ["inc-inc-8"],
        workspaceUserIds: ["U0CONNECTED"],
      },
    });
  });

  test("everybody not connected is handed back once, for the rule's own channels - nothing is posted yet, no message per person", async () => {
    const membersNotAdded: Array<ChannelMembersNotAdded> =
      await createChannels();

    expect(membersNotAdded).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        channels: [{ id: "C0INC8", name: "inc-inc-8" }],
        userIds: [NOT_CONNECTED_1, NOT_CONNECTED_2],
      },
    ]);

    // Not before the record's own first message: nothing is said here.
    expect(sendMessage).not.toHaveBeenCalled();
    expect(noticeSpy).not.toHaveBeenCalled();
  });

  test("an invite Slack refuses does not end the channel's setup, and the people not connected are still handed back", async () => {
    invite.mockRejectedValueOnce(new Error("Error from Slack ratelimited"));

    const membersNotAdded: Array<ChannelMembersNotAdded> =
      await createChannels();

    expect(membersNotAdded).toHaveLength(1);
    expect(membersNotAdded[0]!.userIds).toEqual([
      NOT_CONNECTED_1,
      NOT_CONNECTED_2,
    ]);
  });

  test("nobody connected: no invite is sent, nobody is logged as invited, and everybody is handed back", async () => {
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getWorkspaceUserIdFromOneUptimeUserId",
      )
      .mockResolvedValue(null);

    const membersNotAdded: Array<ChannelMembersNotAdded> =
      await createChannels();

    expect(invite).not.toHaveBeenCalled();
    expect(inviteLogSpy).not.toHaveBeenCalled();
    expect(membersNotAdded[0]!.userIds).toEqual([
      CONNECTED,
      NOT_CONNECTED_1,
      NOT_CONNECTED_2,
    ]);
  });

  test("everybody connected: nothing to hand back", async () => {
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getWorkspaceUserIdFromOneUptimeUserId",
      )
      .mockResolvedValue("U0SOMEBODY");

    expect(await createChannels()).toEqual([]);
    expect(invite).toHaveBeenCalledTimes(1);
  });

  test("Microsoft Teams goes through the same path; the note itself says nothing there (ChannelMembersNotAddedNotice)", async () => {
    const membersNotAdded: Array<ChannelMembersNotAdded> = await createChannels(
      { workspaceType: WorkspaceType.MicrosoftTeams },
    );

    expect(membersNotAdded[0]!.workspaceType).toBe(
      WorkspaceType.MicrosoftTeams,
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(inviteLogSpy).toHaveBeenCalledTimes(1);
    expect(inviteLogSpy.mock.calls[0]![0].workspaceType).toBe(
      WorkspaceType.MicrosoftTeams,
    );
  });

  /*
   * The people a rule adds to the channel it creates for a record used to
   * be logged nowhere: the record's Notification Logs > Workspace tab
   * showed the channel created and its messages, and nobody invited.
   * They are logged against the record, as an owner's or a paged person's
   * invite is.
   */
  test.each(RECORD_FIELDS)(
    "REGRESSION: the people invited to the new channel are logged as invited, against the record it was created for: $field",
    async (data: { field: RecordField }) => {
      const recordId: ObjectID = ObjectID.generate();

      await createChannels({ notificationFor: { [data.field]: recordId } });

      // Only the person invited, and only in the rule's own channel.
      expect(inviteLogSpy).toHaveBeenCalledTimes(1);
      expect(inviteLogSpy.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        channelId: "C0INC8",
        channelName: "inc-inc-8",
        userId: CONNECTED,
        [data.field]: recordId,
      });
      expect(inviteLogSpy.mock.calls[0]![1]).toEqual({ isRoot: true });
    },
  );

  test("everybody invited is logged once in each of the rule's new channels", async () => {
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getWorkspaceUserIdFromOneUptimeUserId",
      )
      .mockResolvedValue("U0SOMEBODY");

    const warRoom: NotificationRuleWorkspaceChannel = {
      id: "C0INC8WAR",
      name: "inc-inc-8-war-room",
      workspaceType: WorkspaceType.Slack,
      notificationRuleId: RULE_ID.toString(),
    };

    await createChannels({
      channels: [RULE_CHANNEL, warRoom, OTHER_RULE_CHANNEL],
      notificationFor: { incidentId: ObjectID.generate() },
    });

    // Still one invite for everybody.
    expect(invite).toHaveBeenCalledTimes(1);

    const logged: Array<string> = inviteLogSpy.mock.calls
      .map(
        (
          call: Parameters<
            typeof WorkspaceNotificationLogService.logInviteUser
          >,
        ): string => {
          return `${call[0].userId.toString()} ${call[0].channelId}`;
        },
      )
      .sort();

    expect(logged).toEqual(
      [CONNECTED, NOT_CONNECTED_1, NOT_CONNECTED_2]
        .flatMap((userId: ObjectID): Array<string> => {
          return [
            `${userId.toString()} C0INC8`,
            `${userId.toString()} C0INC8WAR`,
          ];
        })
        .sort(),
    );
  });

  test("an invite Slack refuses logs nobody as invited", async () => {
    invite.mockRejectedValueOnce(new Error("Error from Slack ratelimited"));

    await createChannels({
      notificationFor: { incidentId: ObjectID.generate() },
    });

    expect(inviteLogSpy).not.toHaveBeenCalled();
  });

  test("no record named: the invite's log row names none", async () => {
    await createChannels();

    expect(inviteLogSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      channelId: "C0INC8",
      channelName: "inc-inc-8",
      userId: CONNECTED,
    });
  });

  test("a log row that cannot be written does not end the channel's setup", async () => {
    inviteLogSpy.mockRejectedValueOnce(new Error("connection refused"));

    const membersNotAdded: Array<ChannelMembersNotAdded> = await createChannels(
      {
        notificationFor: { incidentId: ObjectID.generate() },
      },
    );

    expect(invite).toHaveBeenCalledTimes(1);
    expect(membersNotAdded[0]!.userIds).toEqual([
      NOT_CONNECTED_1,
      NOT_CONNECTED_2,
    ]);
  });
});
