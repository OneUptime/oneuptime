import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
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

function rule(
  id: ObjectID,
  workspaceType: WorkspaceType,
): WorkspaceNotificationRule {
  const model: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  model.id = id;
  model.workspaceType = workspaceType;
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
});

/*
 * A channel just created: the people who could not be added are handed back,
 * not told yet - the record's service tells the channel right after the
 * record's own first message ("Incident INC-8 Created"), so the channel
 * opens on what happened (NewChannelNoteFollowsCreatedMessage.test.ts).
 */
describe("inviteUsersAndTeamsToChannelsBasedOnRules (a channel just created)", () => {
  async function createChannels(
    workspaceType: WorkspaceType = WorkspaceType.Slack,
  ): Promise<Array<ChannelMembersNotAdded>> {
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
        notificationChannels: [RULE_CHANNEL, OTHER_RULE_CHANNEL],
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

  test("nobody connected: no invite is sent, and everybody is handed back", async () => {
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getWorkspaceUserIdFromOneUptimeUserId",
      )
      .mockResolvedValue(null);

    const membersNotAdded: Array<ChannelMembersNotAdded> =
      await createChannels();

    expect(invite).not.toHaveBeenCalled();
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
      WorkspaceType.MicrosoftTeams,
    );

    expect(membersNotAdded[0]!.workspaceType).toBe(
      WorkspaceType.MicrosoftTeams,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
