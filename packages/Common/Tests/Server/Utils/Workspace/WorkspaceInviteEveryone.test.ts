import { afterEach, describe, expect, jest, test } from "@jest/globals";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import ObjectID from "../../../../Types/ObjectID";

jest.mock("../../../../Server/Utils/Logger");

/*
 * ONE REFUSED INVITE STOPS NOBODY ELSE.
 *
 * Channel setup now invites everybody a record's channel needs in one call
 * (inviteUsersToChannels). That call invited them one at a time and stopped
 * at the first the workspace refused - a deactivated or restricted account -
 * so everybody after them was neither invited nor named anywhere. Each
 * invite is now its own: every person is tried in every channel, and the
 * first refusal is thrown once all of them were, so the caller still hears
 * of it (a rule's test reports it).
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

afterEach(() => {
  jest.restoreAllMocks();
});

function inviteTo(
  channelNames: Array<string>,
  workspaceUserIds: Array<string>,
): Promise<void> {
  return SlackUtil.inviteUsersToChannels({
    authToken: "xoxb-token",
    workspaceChannelInvitationPayload: {
      channelNames: channelNames,
      workspaceUserIds: workspaceUserIds,
    },
    projectId: PROJECT_ID,
  });
}

describe("inviteUsersToChannels - every invite is its own", () => {
  test("REGRESSION: a person the workspace refuses does not stop the people after them, in any channel", async () => {
    const invited: Array<string> = [];

    jest
      .spyOn(SlackUtil, "inviteUserToChannelByChannelName")
      .mockImplementation(
        async (data: {
          channelName: string;
          workspaceUserId: string;
        }): Promise<void> => {
          if (data.workspaceUserId === "U0RESTRICTED") {
            throw new BadRequestException(
              "Error from Slack user_is_restricted",
            );
          }

          invited.push(`${data.channelName}:${data.workspaceUserId}`);
        },
      );

    await expect(
      inviteTo(["inc-1", "inc-2"], ["U0ALICE", "U0RESTRICTED", "U0CAROL"]),
    ).rejects.toThrow("Error from Slack user_is_restricted");

    expect(invited).toEqual([
      "inc-1:U0ALICE",
      "inc-1:U0CAROL",
      "inc-2:U0ALICE",
      "inc-2:U0CAROL",
    ]);
  });

  test("a channel that cannot be found does not stop the next channel", async () => {
    const invited: Array<string> = [];

    jest
      .spyOn(SlackUtil, "inviteUserToChannelByChannelName")
      .mockImplementation(
        async (data: {
          channelName: string;
          workspaceUserId: string;
        }): Promise<void> => {
          if (data.channelName === "gone") {
            throw new BadRequestException("Error from Slack channel_not_found");
          }

          invited.push(`${data.channelName}:${data.workspaceUserId}`);
        },
      );

    await expect(inviteTo(["gone", "inc-1"], ["U0ALICE"])).rejects.toThrow(
      "channel_not_found",
    );

    expect(invited).toEqual(["inc-1:U0ALICE"]);
  });

  test("the first refusal is the one thrown", async () => {
    jest
      .spyOn(SlackUtil, "inviteUserToChannelByChannelName")
      .mockImplementation(
        async (data: { workspaceUserId: string }): Promise<void> => {
          throw new BadRequestException(
            `Error from Slack refused ${data.workspaceUserId}`,
          );
        },
      );

    await expect(inviteTo(["inc-1"], ["U0FIRST", "U0SECOND"])).rejects.toThrow(
      "refused U0FIRST",
    );
  });

  test("nobody refused: everybody is invited and nothing is thrown", async () => {
    const invited: Array<string> = [];

    jest
      .spyOn(SlackUtil, "inviteUserToChannelByChannelName")
      .mockImplementation(
        async (data: {
          channelName: string;
          workspaceUserId: string;
        }): Promise<void> => {
          invited.push(`${data.channelName}:${data.workspaceUserId}`);
        },
      );

    await expect(
      inviteTo(["inc-1"], ["U0ALICE", "U0BOB"]),
    ).resolves.toBeUndefined();

    expect(invited).toEqual(["inc-1:U0ALICE", "inc-1:U0BOB"]);
  });
});
