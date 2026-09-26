import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../../../Server/Utils/Workspace/WorkspaceBase";
import Discord from "../../../../Server/Utils/Workspace/Discord/Discord";
import DiscordClient from "../../../../Server/Utils/Workspace/Discord/DiscordClient";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
jest.mock(
  "../../../../Server/Services/WorkspaceProjectAuthTokenService",
  () => {
    return { __esModule: true, default: { getProjectAuth: jest.fn() } };
  },
);
jest.mock("../../../../Server/Utils/Workspace/Discord/DiscordClient");
const guild: string = "111111111111111111";
const parent: string = "222222222222222222";
const thread: string = "333333333333333333";
const projectId: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
);
const authToken: string = "test-bot";
describe("Discord provider simulated lifecycle contract", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (DiscordClient.snowflake as jest.Mock).mockImplementation(
      (value: string) => {
        return value;
      },
    );
    (
      WorkspaceProjectAuthTokenService.getProjectAuth as jest.Mock
    ).mockResolvedValue({
      authToken,
      workspaceProjectId: guild,
      miscData: { incidentChannelId: parent },
    });
    (DiscordClient.request as jest.Mock).mockImplementation(
      async (data: { method: HTTPMethod; path: string }) => {
        if (data.path === `/channels/${parent}`) {
          return { id: parent, guild_id: guild, type: 0, name: "incidents" };
        }
        if (data.path === `/channels/${parent}/threads`) {
          return {
            id: thread,
            guild_id: guild,
            parent_id: parent,
            type: 11,
            name: "incident-1",
          };
        }
        if (data.path === `/channels/${thread}`) {
          return {
            id: thread,
            guild_id: guild,
            parent_id: parent,
            type: 11,
            name: "incident-1",
          };
        }
        throw new Error(`Unexpected request ${data.path}`);
      },
    );
    (DiscordClient.sendMessage as jest.Mock).mockResolvedValue(
      "444444444444444444",
    );
  });
  test("creates a native thread, sends safely and archives without deletion", async () => {
    const channel: WorkspaceChannel = await Discord.createChannel({
      authToken,
      projectId,
      channelName: "incident-1",
    });
    expect(channel.id).toBe(thread);
    await Discord.archiveChannels({
      authToken,
      projectId,
      userId: "user",
      channelIds: [thread],
      sendMessageBeforeArchiving: {
        _type: "WorkspacePayloadMarkdown",
        text: "Resolved @everyone",
      },
    });
    expect(DiscordClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: HTTPMethod.PATCH,
        path: `/channels/${thread}`,
        body: { archived: true, locked: true },
      }),
    );
    expect(DiscordClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          allowed_mentions: { parse: [], replied_user: false },
        }),
      }),
    );
    expect(
      (DiscordClient.request as jest.Mock).mock.calls.some(
        ([request]: Array<{ method: HTTPMethod }>) => {
          return request.method === HTTPMethod.DELETE;
        },
      ),
    ).toBe(false);
  });
  test("rejects cross-guild delivery and continues another destination exactly once", async () => {
    const foreign: string = "555555555555555555";
    const previous: (...args: Array<unknown>) => unknown = (
      DiscordClient.request as jest.Mock
    ).getMockImplementation()!;
    (DiscordClient.request as jest.Mock).mockImplementation(
      (data: { path: string }) => {
        return data.path === `/channels/${foreign}`
          ? Promise.resolve({
              id: foreign,
              guild_id: "999999999999999999",
              type: 0,
            })
          : previous(data);
      },
    );
    const result: WorkspaceSendMessageResponse = await Discord.sendMessage({
      authToken,
      projectId,
      userId: "user",
      workspaceMessagePayload: {
        _type: "WorkspaceMessagePayload",
        workspaceType: WorkspaceType.Discord,
        channelNames: [],
        channelIds: [foreign, thread, thread],
        messageBlocks: [
          { _type: "WorkspacePayloadMarkdown", text: "hello" } as never,
        ],
      },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.threads).toHaveLength(1);
    expect(DiscordClient.sendMessage).toHaveBeenCalledTimes(1);
  });
  test("refuses to archive the configured parent", async () => {
    await expect(
      Discord.archiveChannels({
        authToken,
        projectId,
        userId: "user",
        channelIds: [parent],
        sendMessageBeforeArchiving: {
          _type: "WorkspacePayloadMarkdown",
          text: "Resolved",
        },
      }),
    ).rejects.toThrow("thread");
    expect(DiscordClient.sendMessage).not.toHaveBeenCalled();
  });
});

describe("Discord additional pre-implementation boundary contracts", () => {
  test("refuses an unscoped membership mutation", async () => {
    await expect(
      Discord.inviteUserToChannelByChannelId({
        authToken,
        channelId: thread,
        workspaceUserId: guild,
      }),
    ).rejects.toThrow("project");
  });
  test("requires project scope for thread join", async () => {
    await expect(
      Discord.joinChannel({ authToken, channelId: thread }),
    ).rejects.toThrow("project");
  });
});

describe("Discord generic creation boundary", () => {
  test("refuses generic name-based creation without provider writes", async () => {
    (DiscordClient.request as jest.Mock).mockClear();
    await expect(
      Discord.createChannelsIfDoesNotExist({
        authToken,
        projectId,
        channelNames: ["incident-1"],
      }),
    ).rejects.toThrow();
    expect(DiscordClient.request).not.toHaveBeenCalled();
  });
});
