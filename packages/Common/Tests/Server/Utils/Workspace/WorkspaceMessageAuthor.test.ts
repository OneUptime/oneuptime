import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import { MessageBlocksByWorkspaceType } from "../../../../Server/Services/WorkspaceNotificationRuleService";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";

/*
 * Every note posted to an incident / alert channel starts with its author
 * ("@Jane posted private note ..."). Resolving that name used to be allowed to
 * throw — and for Microsoft Teams it always did, because Graph's
 * GET /users/{id} needs User.Read.All, which OneUptime's app does not have.
 * The exception aborted the whole post, so notes from anyone who had linked
 * Teams never reached Teams OR Slack. These pin down that resolving the author
 * can no longer stop a message.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

type UserAuthByWorkspace = Partial<
  Record<WorkspaceType, WorkspaceUserAuthToken | null>
>;

function userAuth(data: {
  workspaceUserId: string;
  miscData?: Record<string, unknown> | undefined;
}): WorkspaceUserAuthToken {
  const token: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
  token.workspaceUserId = data.workspaceUserId;
  token.miscData = (data.miscData || {}) as never;
  return token;
}

function projectAuth(authToken: string): WorkspaceProjectAuthToken {
  const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  token.projectId = projectId;
  token.authToken = authToken;
  token.miscData = { botUserId: "B0BOT" } as never;
  return token;
}

let getUserAuthSpy: SpyInstance<
  typeof WorkspaceUserAuthTokenService.getUserAuth
>;
let getProjectAuthSpy: SpyInstance<
  typeof WorkspaceProjectAuthTokenService.getProjectAuth
>;
let userMarkdownSpy: SpyInstance<typeof UserService.getUserMarkdownString>;

function mockUserAuths(byWorkspace: UserAuthByWorkspace): void {
  getUserAuthSpy.mockImplementation(
    async (data: {
      workspaceType: WorkspaceType;
    }): Promise<WorkspaceUserAuthToken | null> => {
      return byWorkspace[data.workspaceType] || null;
    },
  );
}

function textFor(
  blocks: Array<MessageBlocksByWorkspaceType>,
  workspaceType: WorkspaceType,
): string {
  const entry: MessageBlocksByWorkspaceType | undefined = blocks.find(
    (b: MessageBlocksByWorkspaceType) => {
      return b.workspaceType === workspaceType;
    },
  );

  return ((entry?.messageBlocks[0] as WorkspacePayloadMarkdown) || {}).text;
}

beforeEach((): void => {
  getUserAuthSpy = jest
    .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
    .mockResolvedValue(null);

  getProjectAuthSpy = jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation(
      async (data: {
        workspaceType: WorkspaceType;
      }): Promise<WorkspaceProjectAuthToken | null> => {
        return projectAuth(
          data.workspaceType === WorkspaceType.Slack
            ? "xoxb-token"
            : "teams-token",
        );
      },
    );

  userMarkdownSpy = jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue("**Jane Doe** (jane@example.com)");
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("WorkspaceUtil.getMessageBlocksByMarkdown", () => {
  test("builds one markdown block per workspace type", async () => {
    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: undefined,
        markdown: "📄 posted **private note**",
      });

    expect(
      blocks.map((b: MessageBlocksByWorkspaceType) => {
        return b.workspaceType;
      }),
    ).toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);

    for (const entry of blocks) {
      expect(entry.messageBlocks).toHaveLength(1);
      expect((entry.messageBlocks[0] as WorkspacePayloadMarkdown).text).toBe(
        "📄 posted **private note**",
      );
    }

    expect(getUserAuthSpy).not.toHaveBeenCalled();
  });

  test("a user with no linked chat account is named by their OneUptime name", async () => {
    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted a note",
      });

    expect(textFor(blocks, WorkspaceType.Slack)).toBe(
      "**Jane Doe** (jane@example.com) posted a note",
    );
    expect(textFor(blocks, WorkspaceType.MicrosoftTeams)).toBe(
      "**Jane Doe** (jane@example.com) posted a note",
    );
  });

  test("REGRESSION: Graph refusing the Teams username lookup no longer aborts the message", async () => {
    // Linked to Teams, but linked before the display name was stored.
    mockUserAuths({
      [WorkspaceType.MicrosoftTeams]: userAuth({ workspaceUserId: "aad-1" }),
    });

    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockResolvedValue("app-token");
    // What Graph answers GET /users/{id} without User.Read.All.
    let graphCalls: number = 0;
    const graphGet: () => Promise<HTTPErrorResponse> = async () => {
      graphCalls++;
      return new HTTPErrorResponse(
        403,
        {
          error: {
            code: "Authorization_RequestDenied",
            message: "Insufficient privileges to complete the operation.",
          },
        },
        {},
      );
    };
    jest.spyOn(API, "get").mockImplementation(graphGet as any);

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted **private note**",
      });

    expect(graphCalls).toBe(1);
    expect(textFor(blocks, WorkspaceType.MicrosoftTeams)).toBe(
      "**Jane Doe** (jane@example.com) posted **private note**",
    );
    // Slack is unaffected by Teams' failure.
    expect(textFor(blocks, WorkspaceType.Slack)).toBe(
      "**Jane Doe** (jane@example.com) posted **private note**",
    );
  });

  test("Teams uses the display name stored when the account was linked, without calling Graph", async () => {
    mockUserAuths({
      [WorkspaceType.MicrosoftTeams]: userAuth({
        workspaceUserId: "aad-1",
        miscData: { displayName: "  Jane Teams  ", userId: "aad-1" },
      }),
    });

    const usernameSpy: SpyInstance<
      typeof MicrosoftTeamsUtil.getUsernameFromUserId
    > = jest.spyOn(MicrosoftTeamsUtil, "getUsernameFromUserId");

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted a note",
      });

    expect(usernameSpy).not.toHaveBeenCalled();
    expect(textFor(blocks, WorkspaceType.MicrosoftTeams)).toBe(
      "@Jane Teams posted a note",
    );
  });

  test("Teams ignores an empty stored display name and asks Graph", async () => {
    mockUserAuths({
      [WorkspaceType.MicrosoftTeams]: userAuth({
        workspaceUserId: "aad-1",
        miscData: { displayName: "   " },
      }),
    });

    const usernameSpy: SpyInstance<
      typeof MicrosoftTeamsUtil.getUsernameFromUserId
    > = jest
      .spyOn(MicrosoftTeamsUtil, "getUsernameFromUserId")
      .mockResolvedValue("Jane From Graph");

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted a note",
      });

    expect(usernameSpy).toHaveBeenCalledWith({
      userId: "aad-1",
      authToken: "teams-token",
      projectId: projectId,
    });
    expect(textFor(blocks, WorkspaceType.MicrosoftTeams)).toBe(
      "@Jane From Graph posted a note",
    );
  });

  test("Slack mentions the linked user by their Slack name", async () => {
    mockUserAuths({
      [WorkspaceType.Slack]: userAuth({ workspaceUserId: "U123" }),
    });

    const slackUsernameSpy: SpyInstance<
      typeof SlackUtil.getUsernameFromUserId
    > = jest
      .spyOn(SlackUtil, "getUsernameFromUserId")
      .mockResolvedValue("jane");

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted a note",
      });

    expect(slackUsernameSpy).toHaveBeenCalledWith({
      userId: "U123",
      authToken: "xoxb-token",
      projectId: projectId,
    });
    expect(textFor(blocks, WorkspaceType.Slack)).toBe("@jane posted a note");
  });

  test('REGRESSION: an unresolvable Slack name is never written as "@null"', async () => {
    mockUserAuths({
      [WorkspaceType.Slack]: userAuth({ workspaceUserId: "U123" }),
    });
    jest.spyOn(SlackUtil, "getUsernameFromUserId").mockResolvedValue(null);

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted a note",
      });

    expect(textFor(blocks, WorkspaceType.Slack)).not.toContain("@null");
    expect(textFor(blocks, WorkspaceType.Slack)).toBe(
      "**Jane Doe** (jane@example.com) posted a note",
    );
  });

  test("a Slack lookup that throws falls back to the OneUptime name", async () => {
    mockUserAuths({
      [WorkspaceType.Slack]: userAuth({ workspaceUserId: "U123" }),
    });
    jest
      .spyOn(SlackUtil, "getUsernameFromUserId")
      .mockRejectedValue(new Error("ratelimited"));

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted a note",
      });

    expect(textFor(blocks, WorkspaceType.Slack)).toBe(
      "**Jane Doe** (jane@example.com) posted a note",
    );
  });

  test("a linked account whose workspace is no longer connected falls back to the OneUptime name", async () => {
    mockUserAuths({
      [WorkspaceType.Slack]: userAuth({ workspaceUserId: "U123" }),
    });
    getProjectAuthSpy.mockResolvedValue(null);
    const slackUsernameSpy: SpyInstance<
      typeof SlackUtil.getUsernameFromUserId
    > = jest.spyOn(SlackUtil, "getUsernameFromUserId");

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted a note",
      });

    expect(slackUsernameSpy).not.toHaveBeenCalled();
    expect(textFor(blocks, WorkspaceType.Slack)).toBe(
      "**Jane Doe** (jane@example.com) posted a note",
    );
  });

  test("the user-auth lookup itself failing does not abort the message", async () => {
    getUserAuthSpy.mockRejectedValue(new Error("database is down"));

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted a note",
      });

    expect(textFor(blocks, WorkspaceType.Slack)).toBe(
      "**Jane Doe** (jane@example.com) posted a note",
    );
    expect(textFor(blocks, WorkspaceType.MicrosoftTeams)).toBe(
      "**Jane Doe** (jane@example.com) posted a note",
    );
  });

  test("when no name can be found at all the message is still sent, unprefixed", async () => {
    userMarkdownSpy.mockRejectedValue(new Error("user lookup failed"));

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted a note",
      });

    expect(textFor(blocks, WorkspaceType.Slack)).toBe("posted a note");
    expect(textFor(blocks, WorkspaceType.MicrosoftTeams)).toBe("posted a note");
  });

  test("an empty OneUptime name adds no stray space", async () => {
    userMarkdownSpy.mockResolvedValue("");

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        projectId: projectId,
        userId: userId,
        markdown: "posted a note",
      });

    expect(textFor(blocks, WorkspaceType.Slack)).toBe("posted a note");
  });
});

describe("WorkspaceUtil.getUserStringForWorkspace", () => {
  test("never throws, whatever fails", async () => {
    getUserAuthSpy.mockRejectedValue(new Error("boom"));
    userMarkdownSpy.mockRejectedValue(new Error("boom"));

    await expect(
      WorkspaceUtil.getUserStringForWorkspace({
        userId: userId,
        projectId: projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).resolves.toBe("");
  });

  test("looks up the user's link in the requested workspace only", async () => {
    await WorkspaceUtil.getUserStringForWorkspace({
      userId: userId,
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    expect(getUserAuthSpy).toHaveBeenCalledWith({
      userId: userId,
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });
});

describe("WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot", () => {
  function payload(data: {
    workspaceType: WorkspaceType;
    channelIds?: Array<string>;
    channelNames?: Array<string>;
    chatIds?: Array<string>;
    teamId?: string;
  }): WorkspaceMessagePayload {
    return {
      _type: "WorkspaceMessagePayload",
      workspaceType: data.workspaceType,
      channelIds: data.channelIds || [],
      channelNames: data.channelNames || [],
      chatIds: data.chatIds,
      teamId: data.teamId,
      messageBlocks: [
        { _type: "WorkspacePayloadMarkdown", text: "hello" },
      ] as Array<WorkspacePayloadMarkdown>,
    };
  }

  test("REGRESSION: one destination throwing does not stop the ones after it", async () => {
    const teamsSendSpy: SpyInstance<typeof MicrosoftTeamsUtil.sendMessage> =
      jest
        .spyOn(MicrosoftTeamsUtil, "sendMessage")
        .mockRejectedValue(
          new Error("Team ID is required to resolve channel names."),
        );

    const slackSendSpy: SpyInstance<typeof SlackUtil.sendMessage> = jest
      .spyOn(SlackUtil, "sendMessage")
      .mockResolvedValue({
        workspaceType: WorkspaceType.Slack,
        threads: [
          {
            channel: {
              id: "C1",
              name: "incident-1",
              workspaceType: WorkspaceType.Slack,
            },
            threadId: "1.2",
          },
        ],
      });

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: projectId,
        messagePayloadsByWorkspace: [
          payload({
            workspaceType: WorkspaceType.MicrosoftTeams,
            channelNames: ["incidents"],
          }),
          payload({ workspaceType: WorkspaceType.Slack, channelIds: ["C1"] }),
        ],
      });

    expect(teamsSendSpy).toHaveBeenCalledTimes(1);
    expect(slackSendSpy).toHaveBeenCalledTimes(1);
    expect(responses).toHaveLength(2);

    expect(responses[0]!.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(responses[0]!.threads).toEqual([]);
    expect(responses[0]!.errors).toEqual([
      {
        channel: {
          id: "",
          name: "incidents",
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        error: "Team ID is required to resolve channel names.",
      },
    ]);

    expect(responses[1]!.threads).toHaveLength(1);
  });

  test("a non-Error rejection is still reported as text", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "sendMessage")
      .mockRejectedValue("socket hang up");

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: projectId,
        messagePayloadsByWorkspace: [
          payload({
            workspaceType: WorkspaceType.MicrosoftTeams,
            channelIds: ["19:abc@thread.tacv2"],
            teamId: "team-1",
          }),
        ],
      });

    expect(responses[0]!.errors).toEqual([
      {
        channel: {
          id: "19:abc@thread.tacv2",
          name: "19:abc@thread.tacv2",
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: "team-1",
        },
        error: "socket hang up",
      },
    ]);
  });

  test("a workspace that is not connected is skipped without sending", async () => {
    getProjectAuthSpy.mockResolvedValue(null);
    const teamsSendSpy: SpyInstance<typeof MicrosoftTeamsUtil.sendMessage> =
      jest.spyOn(MicrosoftTeamsUtil, "sendMessage");

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: projectId,
        messagePayloadsByWorkspace: [
          payload({
            workspaceType: WorkspaceType.MicrosoftTeams,
            channelIds: ["19:abc@thread.tacv2"],
            teamId: "team-1",
          }),
        ],
      });

    expect(teamsSendSpy).not.toHaveBeenCalled();
    expect(responses).toEqual([
      { workspaceType: WorkspaceType.MicrosoftTeams, threads: [] },
    ]);
  });

  test("Slack without a bot user is skipped; Teams needs no bot user id", async () => {
    getProjectAuthSpy.mockImplementation(
      async (data: {
        workspaceType: WorkspaceType;
      }): Promise<WorkspaceProjectAuthToken | null> => {
        const token: WorkspaceProjectAuthToken = projectAuth("token");
        token.miscData = {} as never;
        token.workspaceType = data.workspaceType;
        return token;
      },
    );

    const slackSendSpy: SpyInstance<typeof SlackUtil.sendMessage> = jest.spyOn(
      SlackUtil,
      "sendMessage",
    );
    const teamsSendSpy: SpyInstance<typeof MicrosoftTeamsUtil.sendMessage> =
      jest.spyOn(MicrosoftTeamsUtil, "sendMessage").mockResolvedValue({
        workspaceType: WorkspaceType.MicrosoftTeams,
        threads: [],
      });

    await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
      projectId: projectId,
      messagePayloadsByWorkspace: [
        payload({ workspaceType: WorkspaceType.Slack, channelIds: ["C1"] }),
        payload({
          workspaceType: WorkspaceType.MicrosoftTeams,
          channelIds: ["19:abc@thread.tacv2"],
          teamId: "team-1",
        }),
      ],
    });

    expect(slackSendSpy).not.toHaveBeenCalled();
    expect(teamsSendSpy).toHaveBeenCalledTimes(1);
    expect(teamsSendSpy.mock.calls[0]![0].userId).toBe("");
  });
});

describe("WorkspaceUtil.describePayloadDestination", () => {
  test.each([
    {
      name: "a channel id",
      payload: { channelIds: ["C1"], channelNames: [], chatIds: ["chat"] },
      expected: { id: "C1", name: "C1" },
    },
    {
      name: "a channel name",
      payload: { channelIds: [], channelNames: ["incidents"] },
      expected: { id: "", name: "incidents" },
    },
    {
      name: "a Teams chat",
      payload: { channelIds: [], channelNames: [], chatIds: ["19:chat"] },
      expected: { id: "19:chat", name: "19:chat" },
    },
    {
      name: "nothing",
      payload: { channelIds: [], channelNames: [] },
      expected: { id: "", name: "" },
    },
  ])(
    "$name",
    ({
      payload,
      expected,
    }: {
      payload: Partial<WorkspaceMessagePayload>;
      expected: { id: string; name: string };
    }) => {
      expect(
        WorkspaceUtil.describePayloadDestination({
          _type: "WorkspaceMessagePayload",
          workspaceType: WorkspaceType.Slack,
          messageBlocks: [],
          ...payload,
        } as WorkspaceMessagePayload),
      ).toEqual({ ...expected, workspaceType: WorkspaceType.Slack });
    },
  );
});
