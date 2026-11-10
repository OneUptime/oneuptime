import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * SLACK, MICROSOFT TEAMS AND MATTERMOST CHANNEL POSTS AND INCOMING WEBHOOKS,
 * FOR THE PLATFORM'S OPERATOR (issue #6645).
 *
 * A message a project's bot posts into channels is counted once a channel -
 * notification.send.count and .duration, notification.destination
 * "channel" - however many messages a workspace's limits split it into. A
 * channel that could not be found or read is a failure with no time of its
 * own, and a message that failed as a whole fails each channel not tried
 * yet. A post to an incoming webhook - a status page subscriber's, or the
 * installation's own notices to its operator - is counted once,
 * "incoming_webhook", through the project's webhook or, for the operator's
 * notices, the installation's ("global"). A workflow's own post is no
 * notification, and is not counted. Nothing here names a channel, a person
 * or a message: every attribute is one of a few values.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];
const sendDurationCalls: Array<RecordedCall> = [];

jest.mock("../../../../Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return {
          record: (value: number, attributes: Record<string, string>): void => {
            sendDurationCalls.push({ value, attributes });
          },
        };
      },
    },
  };
});

import WorkspaceDeliveryMetrics, {
  WorkspaceChannelPost,
  WorkspaceChannelPosts,
} from "../../../../Server/Utils/Workspace/WorkspaceDeliveryMetrics";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MattermostUtil, {
  MattermostChannel,
} from "../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostConnection from "../../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../../../../Server/Utils/Workspace/WorkspaceBase";
import OperatorSlackNotice from "../../../../Server/Utils/OperatorSlackNotice";
import SSRFProtection from "../../../../Server/Utils/SSRFProtection";
import logger from "../../../../Server/Utils/Logger";
import { NotificationProviderConfig } from "../../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import { MicrosoftTeamsChat } from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";

const PROJECT_ID: ObjectID = new ObjectID(
  "66450000-0000-4000-8000-000000000001",
);

// A workspace the metrics do not know: a type added later, or a bad row.
const UNKNOWN_WORKSPACE: WorkspaceType = "Discord" as unknown as WorkspaceType;

const SLACK_WEBHOOK: string = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_WEBHOOK: string =
  "https://acme.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi";
const MATTERMOST_WEBHOOK: string = "https://chat.example.com/hooks/abc123";

function markdownBlocks(count: number): Array<WorkspaceMessageBlock> {
  const blocks: Array<WorkspaceMessageBlock> = [];

  for (let index: number = 0; index < count; index++) {
    const block: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `**Incident #${index + 1}** Checkout API is down`,
    };

    blocks.push(block);
  }

  return blocks;
}

function payloadFor(data: {
  workspaceType: WorkspaceType;
  channelNames?: Array<string> | undefined;
  channelIds?: Array<string> | undefined;
  chatIds?: Array<string> | undefined;
  exceptChannelIds?: Array<string> | undefined;
  teamId?: string | undefined;
  blockCount?: number | undefined;
}): WorkspaceMessagePayload {
  const payload: WorkspaceMessagePayload = {
    _type: "WorkspaceMessagePayload",
    workspaceType: data.workspaceType,
    channelNames: data.channelNames || [],
    channelIds: data.channelIds || [],
    messageBlocks: markdownBlocks(data.blockCount || 1),
    text: "Incident #1 Checkout API is down",
  };

  if (data.chatIds) {
    payload.chatIds = data.chatIds;
  }

  if (data.exceptChannelIds) {
    payload.exceptChannelIds = data.exceptChannelIds;
  }

  if (data.teamId) {
    payload.teamId = data.teamId;
  }

  return payload;
}

// What every post of a workspace is recorded with, and how it went.
function channelPost(
  channel: string,
  outcome: string,
  destination: string = "channel",
  providerConfig: string = "project",
): Record<string, string> {
  return {
    "notification.channel": channel,
    "notification.provider": channel,
    "notification.provider.config": providerConfig,
    "notification.on_call_page": "false",
    "notification.destination": destination,
    outcome: outcome,
  };
}

function counted(): Array<Record<string, string>> {
  return sendCounterCalls.map((call: RecordedCall) => {
    expect(call.value).toBe(1);
    return call.attributes;
  });
}

function timed(): Array<Record<string, string>> {
  return sendDurationCalls.map((call: RecordedCall) => {
    expect(call.value).toBeGreaterThanOrEqual(0);
    return call.attributes;
  });
}

function outcomes(): Array<string> {
  return counted().map((attributes: Record<string, string>): string => {
    return attributes["outcome"]!;
  });
}

beforeEach(() => {
  sendCounterCalls.length = 0;
  sendDurationCalls.length = 0;

  // A send that failed is logged: kept out of the test's output.
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceDeliveryMetrics.getChannelPostStart", () => {
  test.each([
    [WorkspaceType.Slack, "slack"],
    [WorkspaceType.MicrosoftTeams, "microsoft_teams"],
    [WorkspaceType.Mattermost, "mattermost"],
  ])(
    "%s: posted as the project's bot, into a channel, never an on-call page",
    (workspaceType: WorkspaceType, name: string) => {
      expect(WorkspaceDeliveryMetrics.getChannelPostStart(workspaceType)).toEqual(
        {
          channel: name,
          provider: name,
          providerConfig: "project",
          isOnCallPage: false,
          destination: "channel",
        },
      );
    },
  );

  test("a workspace the metrics do not know has none", () => {
    expect(
      WorkspaceDeliveryMetrics.getChannelPostStart(UNKNOWN_WORKSPACE),
    ).toBeNull();
  });
});

describe("WorkspaceDeliveryMetrics.countDestinations", () => {
  test("each channel name and each channel id a message names", () => {
    expect(
      WorkspaceDeliveryMetrics.countDestinations(
        payloadFor({
          workspaceType: WorkspaceType.Slack,
          channelNames: ["#incidents", "ops"],
          channelIds: ["C1", "C2", "C3"],
        }),
        WorkspaceType.Slack,
      ),
    ).toBe(5);
  });

  test("less each id the message is not for", () => {
    expect(
      WorkspaceDeliveryMetrics.countDestinations(
        payloadFor({
          workspaceType: WorkspaceType.Slack,
          channelNames: ["incidents"],
          channelIds: ["C1", "C2", "C3"],
          exceptChannelIds: ["C2", "C-not-named"],
        }),
        WorkspaceType.Slack,
      ),
    ).toBe(3);
  });

  test("Microsoft Teams posts in chats too: each chat it names is one there", () => {
    expect(
      WorkspaceDeliveryMetrics.countDestinations(
        payloadFor({
          workspaceType: WorkspaceType.MicrosoftTeams,
          channelNames: ["Alerts"],
          channelIds: ["19:a@thread.tacv2"],
          chatIds: ["19:chat-1@thread.v2", "19:chat-2@thread.v2"],
          teamId: "team-1",
        }),
        WorkspaceType.MicrosoftTeams,
      ),
    ).toBe(4);
  });

  test.each([WorkspaceType.Slack, WorkspaceType.Mattermost])(
    "%s posts in no chats: a chat a message names is none there",
    (workspaceType: WorkspaceType) => {
      expect(
        WorkspaceDeliveryMetrics.countDestinations(
          payloadFor({
            workspaceType: workspaceType,
            channelIds: ["C1"],
            chatIds: ["19:chat-1@thread.v2"],
          }),
          workspaceType,
        ),
      ).toBe(1);
    },
  );

  test("a message that names nothing has none", () => {
    expect(
      WorkspaceDeliveryMetrics.countDestinations(
        payloadFor({ workspaceType: WorkspaceType.Slack }),
        WorkspaceType.Slack,
      ),
    ).toBe(0);
  });

  test("a payload missing its lists - an old queued job's - has none, and does not throw", () => {
    const payload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: [],
    } as unknown as WorkspaceMessagePayload;

    expect(
      WorkspaceDeliveryMetrics.countDestinations(
        payload,
        WorkspaceType.MicrosoftTeams,
      ),
    ).toBe(0);
  });
});

describe("WorkspaceChannelPosts", () => {
  function postsFor(
    workspaceType: WorkspaceType,
    destinations: {
      channelNames?: Array<string> | undefined;
      channelIds?: Array<string> | undefined;
      chatIds?: Array<string> | undefined;
    } = { channelIds: ["C1", "C2", "C3"] },
  ): WorkspaceChannelPosts {
    return new WorkspaceChannelPosts({
      workspaceType: workspaceType,
      payload: payloadFor({
        workspaceType: workspaceType,
        ...destinations,
        teamId: "team-1",
      }),
    });
  }

  test("a post the workspace took: one success, timed", () => {
    postsFor(WorkspaceType.Slack).startPost().succeeded();

    expect(counted()).toEqual([channelPost("slack", "success")]);
    expect(timed()).toEqual([channelPost("slack", "success")]);
  });

  test("a post the workspace refused: one failure, timed", () => {
    postsFor(WorkspaceType.MicrosoftTeams).startPost().failed();

    expect(counted()).toEqual([channelPost("microsoft_teams", "failure")]);
    expect(timed()).toEqual([channelPost("microsoft_teams", "failure")]);
  });

  test("a post settles once: what follows its first end records nothing", () => {
    const posts: WorkspaceChannelPosts = postsFor(WorkspaceType.Mattermost);
    const succeeded: WorkspaceChannelPost = posts.startPost();

    succeeded.succeeded();
    succeeded.failed();
    succeeded.succeeded();

    const failed: WorkspaceChannelPost = posts.startPost();

    failed.failed();
    failed.succeeded();

    expect(outcomes()).toEqual(["success", "failure"]);
    expect(sendDurationCalls).toHaveLength(2);
  });

  test("a post never ended records nothing", () => {
    postsFor(WorkspaceType.Slack).startPost();

    expect(sendCounterCalls).toEqual([]);
    expect(sendDurationCalls).toEqual([]);
  });

  test("a channel that could not be found: a failure, with no time of its own", () => {
    postsFor(WorkspaceType.Slack).recordChannelNotFound();

    expect(counted()).toEqual([channelPost("slack", "failure")]);
    expect(sendDurationCalls).toEqual([]);
  });

  test("a message failing as a whole: each channel not tried yet is a failure, untimed", () => {
    const posts: WorkspaceChannelPosts = postsFor(WorkspaceType.Slack, {
      channelNames: ["incidents", "ops"],
      channelIds: ["C1", "C2"],
    });

    posts.startPost().succeeded();
    posts.recordChannelNotFound();
    posts.recordRestAsFailed();

    expect(outcomes()).toEqual(["success", "failure", "failure", "failure"]);
    // Only the post made was timed.
    expect(timed()).toEqual([channelPost("slack", "success")]);
  });

  test("the rest is failed once: a second failure as a whole adds nothing", () => {
    const posts: WorkspaceChannelPosts = postsFor(WorkspaceType.Slack, {
      channelIds: ["C1", "C2"],
    });

    posts.recordRestAsFailed();
    posts.recordRestAsFailed();

    expect(outcomes()).toEqual(["failure", "failure"]);
  });

  test("a post started but not settled when the message failed counts as tried: it ends as its own", () => {
    const posts: WorkspaceChannelPosts = postsFor(WorkspaceType.Slack, {
      channelIds: ["C1", "C2"],
    });

    const post: WorkspaceChannelPost = posts.startPost();

    posts.recordRestAsFailed();
    post.failed();

    expect(outcomes()).toEqual(["failure", "failure"]);
    expect(sendDurationCalls).toHaveLength(1);
  });

  test("a message every channel of which was tried has no rest to fail", () => {
    const posts: WorkspaceChannelPosts = postsFor(WorkspaceType.Slack, {
      channelIds: ["C1"],
    });

    posts.startPost().succeeded();
    posts.recordRestAsFailed();

    expect(outcomes()).toEqual(["success"]);
  });

  test("Teams' chats are among what is failed as a whole", () => {
    postsFor(WorkspaceType.MicrosoftTeams, {
      channelIds: ["19:a@thread.tacv2"],
      chatIds: ["19:chat-1@thread.v2", "19:chat-2@thread.v2"],
    }).recordRestAsFailed();

    expect(counted()).toEqual([
      channelPost("microsoft_teams", "failure"),
      channelPost("microsoft_teams", "failure"),
      channelPost("microsoft_teams", "failure"),
    ]);
  });

  test("a workspace the metrics do not know records nothing, and its posts can still be ended", () => {
    const posts: WorkspaceChannelPosts = postsFor(UNKNOWN_WORKSPACE);

    const post: WorkspaceChannelPost = posts.startPost();

    post.succeeded();
    post.failed();
    posts.recordChannelNotFound();
    posts.recordRestAsFailed();

    expect(sendCounterCalls).toEqual([]);
    expect(sendDurationCalls).toEqual([]);
  });
});

describe("WorkspaceDeliveryMetrics.recordChannelPostsNotSent", () => {
  test("each channel and chat a blocked project's message names is not sent, untimed", () => {
    WorkspaceDeliveryMetrics.recordChannelPostsNotSent({
      workspaceType: WorkspaceType.MicrosoftTeams,
      payload: payloadFor({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelNames: ["Alerts"],
        channelIds: ["19:a@thread.tacv2", "19:b@thread.tacv2"],
        chatIds: ["19:chat-1@thread.v2"],
        teamId: "team-1",
      }),
    });

    expect(counted()).toEqual([
      channelPost("microsoft_teams", "not_sent"),
      channelPost("microsoft_teams", "not_sent"),
      channelPost("microsoft_teams", "not_sent"),
      channelPost("microsoft_teams", "not_sent"),
    ]);
    expect(sendDurationCalls).toEqual([]);
  });

  test("a channel the message is not for is not counted", () => {
    WorkspaceDeliveryMetrics.recordChannelPostsNotSent({
      workspaceType: WorkspaceType.Slack,
      payload: payloadFor({
        workspaceType: WorkspaceType.Slack,
        channelIds: ["C1", "C2"],
        exceptChannelIds: ["C2"],
      }),
    });

    expect(counted()).toEqual([channelPost("slack", "not_sent")]);
  });

  test("a message naming no channel records nothing", () => {
    WorkspaceDeliveryMetrics.recordChannelPostsNotSent({
      workspaceType: WorkspaceType.Mattermost,
      payload: payloadFor({ workspaceType: WorkspaceType.Mattermost }),
    });

    expect(sendCounterCalls).toEqual([]);
  });

  test("a workspace the metrics do not know records nothing", () => {
    WorkspaceDeliveryMetrics.recordChannelPostsNotSent({
      workspaceType: UNKNOWN_WORKSPACE,
      payload: payloadFor({
        workspaceType: UNKNOWN_WORKSPACE,
        channelIds: ["C1"],
      }),
    });

    expect(sendCounterCalls).toEqual([]);
  });
});

describe("WorkspaceDeliveryMetrics.measureIncomingWebhookPost", () => {
  const TOOK_IT: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
    200,
    {},
    {},
  );

  test.each([
    [WorkspaceType.Slack, "slack"],
    [WorkspaceType.MicrosoftTeams, "microsoft_teams"],
    [WorkspaceType.Mattermost, "mattermost"],
  ])(
    "%s took it: a success, timed, through the project's webhook",
    async (workspaceType: WorkspaceType, name: string) => {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await WorkspaceDeliveryMetrics.measureIncomingWebhookPost(
          { workspaceType: workspaceType },
          async (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
            return TOOK_IT;
          },
        );

      expect(response).toBe(TOOK_IT);
      expect(counted()).toEqual([
        channelPost(name, "success", "incoming_webhook"),
      ]);
      expect(timed()).toEqual([
        channelPost(name, "success", "incoming_webhook"),
      ]);
    },
  );

  test("answered with an error: a failure, timed, and the answer is passed on", async () => {
    const refused: HTTPErrorResponse = new HTTPErrorResponse(
      404,
      { error: "no_service" },
      {},
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await WorkspaceDeliveryMetrics.measureIncomingWebhookPost(
        { workspaceType: WorkspaceType.Slack },
        async (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
          return refused;
        },
      );

    expect(response).toBe(refused);
    expect(counted()).toEqual([
      channelPost("slack", "failure", "incoming_webhook"),
    ]);
    expect(timed()).toEqual([
      channelPost("slack", "failure", "incoming_webhook"),
    ]);
  });

  test("a post that threw: a failure, and the error is passed on", async () => {
    const error: Error = new Error("socket hang up");

    await expect(
      WorkspaceDeliveryMetrics.measureIncomingWebhookPost(
        { workspaceType: WorkspaceType.MicrosoftTeams },
        async (): Promise<HTTPResponse<JSONObject>> => {
          throw error;
        },
      ),
    ).rejects.toBe(error);

    expect(counted()).toEqual([
      channelPost("microsoft_teams", "failure", "incoming_webhook"),
    ]);
  });

  test.each([null, undefined])(
    "answered with nothing (%s): a failure",
    async (nothing: null | undefined) => {
      await WorkspaceDeliveryMetrics.measureIncomingWebhookPost(
        { workspaceType: WorkspaceType.Slack },
        async (): Promise<HTTPResponse<JSONObject> | null | undefined> => {
          return nothing;
        },
      );

      expect(outcomes()).toEqual(["failure"]);
    },
  );

  test("the installation's own webhook: global", async () => {
    await WorkspaceDeliveryMetrics.measureIncomingWebhookPost(
      {
        workspaceType: WorkspaceType.Slack,
        providerConfig: NotificationProviderConfig.Global,
      },
      async (): Promise<HTTPResponse<JSONObject>> => {
        return TOOK_IT;
      },
    );

    expect(counted()).toEqual([
      channelPost("slack", "success", "incoming_webhook", "global"),
    ]);
  });

  test("a post that is no notification is made, and not recorded", async () => {
    let made: number = 0;

    const response: HTTPResponse<JSONObject> =
      await WorkspaceDeliveryMetrics.measureIncomingWebhookPost(
        { workspaceType: WorkspaceType.Slack, isNotification: false },
        async (): Promise<HTTPResponse<JSONObject>> => {
          made++;
          return TOOK_IT;
        },
      );

    expect(response).toBe(TOOK_IT);
    expect(made).toBe(1);
    expect(sendCounterCalls).toEqual([]);
    expect(sendDurationCalls).toEqual([]);
  });

  test("a post that is no notification and throws: passed on, not recorded", async () => {
    await expect(
      WorkspaceDeliveryMetrics.measureIncomingWebhookPost(
        { workspaceType: WorkspaceType.Slack, isNotification: false },
        async (): Promise<HTTPResponse<JSONObject>> => {
          throw new Error("refused");
        },
      ),
    ).rejects.toThrow("refused");

    expect(sendCounterCalls).toEqual([]);
  });

  test("a workspace the metrics do not know: made, and not recorded", async () => {
    let made: number = 0;

    await WorkspaceDeliveryMetrics.measureIncomingWebhookPost(
      { workspaceType: UNKNOWN_WORKSPACE },
      async (): Promise<HTTPResponse<JSONObject>> => {
        made++;
        return TOOK_IT;
      },
    );

    expect(made).toBe(1);
    expect(sendCounterCalls).toEqual([]);
  });
});

describe("SlackUtil.sendMessage: a post a channel", () => {
  function channel(id: string, name: string = id): WorkspaceChannel {
    return { id: id, name: name, workspaceType: WorkspaceType.Slack };
  }

  let sendBlocks: jest.SpiedFunction<
    typeof SlackUtil.sendPayloadBlocksToChannel
  >;

  beforeEach(() => {
    jest
      .spyOn(SlackUtil, "getWorkspaceChannelFromChannelId")
      .mockImplementation(
        async (data: { channelId: string }): Promise<WorkspaceChannel> => {
          return channel(data.channelId);
        },
      );
    jest
      .spyOn(SlackUtil, "getWorkspaceChannelByName")
      .mockImplementation(
        async (data: {
          channelName: string;
        }): Promise<WorkspaceChannel | null> => {
          return data.channelName === "missing"
            ? null
            : channel(`C-${data.channelName}`, data.channelName);
        },
      );
    jest.spyOn(SlackUtil, "isUserInChannel").mockResolvedValue(true);
    jest.spyOn(SlackUtil, "joinChannel").mockResolvedValue(undefined);
    sendBlocks = jest
      .spyOn(SlackUtil, "sendPayloadBlocksToChannel")
      .mockImplementation(
        async (data: {
          workspaceChannel: WorkspaceChannel;
        }): Promise<WorkspaceThread> => {
          return { channel: data.workspaceChannel, threadId: "1700000000.1" };
        },
      );
  });

  function send(
    payload: Partial<WorkspaceMessagePayload> & { blockCount?: number },
    userId: string = "",
  ): Promise<WorkspaceSendMessageResponse> {
    return SlackUtil.sendMessage({
      workspaceMessagePayload: payloadFor({
        workspaceType: WorkspaceType.Slack,
        channelNames: payload.channelNames,
        channelIds: payload.channelIds,
        exceptChannelIds: payload.exceptChannelIds,
        blockCount: payload.blockCount,
      }),
      authToken: "xoxb-project-bot-token",
      userId: userId,
      projectId: PROJECT_ID,
    });
  }

  test("each channel posted in: one success, timed, as the project's bot", async () => {
    const response: WorkspaceSendMessageResponse = await send({
      channelNames: ["#incidents"],
      channelIds: ["C1"],
    });

    expect(response.threads).toHaveLength(2);
    expect(counted()).toEqual([
      channelPost("slack", "success"),
      channelPost("slack", "success"),
    ]);
    expect(timed()).toEqual([
      channelPost("slack", "success"),
      channelPost("slack", "success"),
    ]);
  });

  test("a message over Slack's block limit is one post a channel, however many messages it is split into", async () => {
    await send({
      channelIds: ["C1", "C2"],
      blockCount: SlackUtil.MAX_BLOCKS_PER_MESSAGE * 2 + 5,
    });

    // Each channel was sent the message in more than one Slack message...
    expect(sendBlocks.mock.calls.length).toBeGreaterThanOrEqual(6);
    // ...and each is one post.
    expect(outcomes()).toEqual(["success", "success"]);
    expect(sendDurationCalls).toHaveLength(2);
  });

  test("a channel name that names nothing: a failure, untimed - the others are posted in", async () => {
    const response: WorkspaceSendMessageResponse = await send({
      channelNames: ["missing", "ops"],
      channelIds: ["C1"],
    });

    expect(response.threads).toHaveLength(2);
    expect(outcomes()).toEqual(["failure", "success", "success"]);
    expect(timed()).toEqual([
      channelPost("slack", "success"),
      channelPost("slack", "success"),
    ]);
  });

  test("a channel Slack refused: a failure, timed - the others succeed", async () => {
    sendBlocks.mockImplementation(
      async (data: {
        workspaceChannel: WorkspaceChannel;
      }): Promise<WorkspaceThread> => {
        if (data.workspaceChannel.id === "C1") {
          throw new HTTPErrorResponse(
            403,
            { ok: false, error: "is_archived" },
            {},
          );
        }

        return { channel: data.workspaceChannel, threadId: "1700000000.2" };
      },
    );

    const response: WorkspaceSendMessageResponse = await send({
      channelIds: ["C1", "C2"],
    });

    expect(response.errors).toHaveLength(1);
    expect(counted()).toEqual([
      channelPost("slack", "failure"),
      channelPost("slack", "success"),
    ]);
    expect(timed()).toEqual([
      channelPost("slack", "failure"),
      channelPost("slack", "success"),
    ]);
  });

  test("a channel the bot could not join: a failure for it", async () => {
    jest.spyOn(SlackUtil, "isUserInChannel").mockResolvedValue(false);
    jest
      .spyOn(SlackUtil, "joinChannel")
      .mockRejectedValue(new Error("Error from Slack method_not_allowed"));

    await send({ channelIds: ["C1"] }, "U0BOT");

    expect(sendBlocks).not.toHaveBeenCalled();
    expect(outcomes()).toEqual(["failure"]);
    expect(sendDurationCalls).toHaveLength(1);
  });

  test("a channel id Slack could not read is still posted in, as before: counted as its post went", async () => {
    jest
      .spyOn(SlackUtil, "getWorkspaceChannelFromChannelId")
      .mockRejectedValue(new Error("channel_not_found"));

    await send({ channelIds: ["C1"] });

    expect(sendBlocks).toHaveBeenCalledTimes(1);
    expect(outcomes()).toEqual(["success"]);
  });

  test("a channel the message is not for is neither posted in nor counted", async () => {
    await send({
      channelNames: ["ops"],
      channelIds: ["C1", "C2"],
      exceptChannelIds: ["C2", "C-ops"],
    });

    expect(sendBlocks).toHaveBeenCalledTimes(1);
    expect(outcomes()).toEqual(["success"]);
  });

  test("Slack could not be asked where to post: each channel the message names is a failure, and the error is passed on", async () => {
    jest
      .spyOn(SlackUtil, "getWorkspaceChannelByName")
      .mockRejectedValue(new Error("ratelimited"));

    await expect(
      send({ channelNames: ["incidents", "ops"], channelIds: ["C1"] }),
    ).rejects.toThrow("ratelimited");

    expect(sendBlocks).not.toHaveBeenCalled();
    expect(counted()).toEqual([
      channelPost("slack", "failure"),
      channelPost("slack", "failure"),
      channelPost("slack", "failure"),
    ]);
    expect(sendDurationCalls).toEqual([]);
  });

  test("a message naming no channel records nothing", async () => {
    await send({});

    expect(sendCounterCalls).toEqual([]);
  });
});

describe("MicrosoftTeamsUtil.sendMessage: a post a channel or chat", () => {
  const TEAM_ID: string = "team-1";
  const CHAT: MicrosoftTeamsChat = {
    id: "19:chat-1@thread.v2",
    name: "Ops group chat",
    chatType: "groupChat",
  };

  function channel(id: string, name: string = id): WorkspaceChannel {
    return {
      id: id,
      name: name,
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAM_ID,
    };
  }

  let sendToChannel: jest.SpiedFunction<
    typeof MicrosoftTeamsUtil.sendAdaptiveCardToChannel
  >;
  let sendToChat: jest.SpiedFunction<
    typeof MicrosoftTeamsUtil.sendAdaptiveCardToChat
  >;

  beforeEach(() => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockImplementation(
        async (data: { channelId: string }): Promise<WorkspaceChannel> => {
          return channel(data.channelId);
        },
      );
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelByName")
      .mockImplementation(
        async (data: {
          channelName: string;
        }): Promise<WorkspaceChannel | null> => {
          return data.channelName === "missing"
            ? null
            : channel(`19:${data.channelName}@thread.tacv2`, data.channelName);
        },
      );
    jest
      .spyOn(MicrosoftTeamsUtil, "getChatsForProject")
      .mockResolvedValue({ [CHAT.id]: CHAT });
    sendToChannel = jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChannel")
      .mockImplementation(
        async (data: {
          workspaceChannel: WorkspaceChannel;
        }): Promise<WorkspaceThread> => {
          return { channel: data.workspaceChannel, threadId: "thread-1" };
        },
      );
    sendToChat = jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockImplementation(
        async (data: { chatId: string }): Promise<WorkspaceThread> => {
          return { channel: channel(data.chatId), threadId: "thread-2" };
        },
      );
  });

  function send(data: {
    channelNames?: Array<string> | undefined;
    channelIds?: Array<string> | undefined;
    chatIds?: Array<string> | undefined;
    teamId?: string | undefined;
    blockCount?: number | undefined;
  }): Promise<WorkspaceSendMessageResponse> {
    return MicrosoftTeamsUtil.sendMessage({
      workspaceMessagePayload: payloadFor({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelNames: data.channelNames,
        channelIds: data.channelIds,
        chatIds: data.chatIds,
        teamId: "teamId" in data ? data.teamId : TEAM_ID,
        blockCount: data.blockCount,
      }),
      authToken: "graph-token",
      userId: "user-1",
      projectId: PROJECT_ID,
    });
  }

  test("each channel and chat posted in: one success each, timed", async () => {
    const response: WorkspaceSendMessageResponse = await send({
      channelNames: ["Alerts"],
      channelIds: ["19:a@thread.tacv2"],
      chatIds: [CHAT.id],
    });

    expect(response.threads).toHaveLength(3);
    expect(counted()).toEqual([
      channelPost("microsoft_teams", "success"),
      channelPost("microsoft_teams", "success"),
      channelPost("microsoft_teams", "success"),
    ]);
    expect(sendDurationCalls).toHaveLength(3);
  });

  test("a message split into several cards is one post a channel and one a chat", async () => {
    await send({
      channelIds: ["19:a@thread.tacv2"],
      chatIds: [CHAT.id],
      blockCount: 100,
    });

    expect(sendToChannel.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(sendToChat.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(outcomes()).toEqual(["success", "success"]);
  });

  test("a channel id Teams could not read: a failure, untimed", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockRejectedValue(
        new HTTPErrorResponse(404, { error: { message: "Not found." } }, {}),
      );

    const response: WorkspaceSendMessageResponse = await send({
      channelIds: ["19:gone@thread.tacv2"],
    });

    expect(response.errors).toHaveLength(1);
    expect(counted()).toEqual([channelPost("microsoft_teams", "failure")]);
    expect(sendDurationCalls).toEqual([]);
  });

  test("a channel name that names nothing: a failure, untimed - the others are posted in", async () => {
    await send({
      channelNames: ["missing", "Alerts"],
      chatIds: [CHAT.id],
    });

    expect(outcomes()).toEqual(["failure", "success", "success"]);
    expect(sendDurationCalls).toHaveLength(2);
  });

  test("a channel Teams refused: a failure, timed", async () => {
    sendToChannel.mockRejectedValue(new Error("Forbidden"));

    await send({ channelIds: ["19:a@thread.tacv2"] });

    expect(counted()).toEqual([channelPost("microsoft_teams", "failure")]);
    expect(timed()).toEqual([channelPost("microsoft_teams", "failure")]);
  });

  test("a chat Teams refused: a failure, timed", async () => {
    sendToChat.mockRejectedValue(new Error("Bot is not part of the chat"));

    await send({ channelIds: ["19:a@thread.tacv2"], chatIds: [CHAT.id] });

    expect(outcomes()).toEqual(["success", "failure"]);
    expect(sendDurationCalls).toHaveLength(2);
  });

  test("a channel the message is not for is neither posted in nor counted", async () => {
    await MicrosoftTeamsUtil.sendMessage({
      workspaceMessagePayload: payloadFor({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelIds: ["19:a@thread.tacv2", "19:b@thread.tacv2"],
        exceptChannelIds: ["19:b@thread.tacv2"],
        teamId: TEAM_ID,
      }),
      authToken: "graph-token",
      userId: "user-1",
      projectId: PROJECT_ID,
    });

    expect(sendToChannel).toHaveBeenCalledTimes(1);
    expect(outcomes()).toEqual(["success"]);
  });

  test("a message naming channels but no team: each channel and chat it names is a failure, and the error is passed on", async () => {
    await expect(
      send({
        channelNames: ["Alerts"],
        channelIds: ["19:a@thread.tacv2"],
        chatIds: [CHAT.id],
        teamId: undefined,
      }),
    ).rejects.toThrow(BadDataException);

    expect(sendToChannel).not.toHaveBeenCalled();
    expect(sendToChat).not.toHaveBeenCalled();
    expect(counted()).toEqual([
      channelPost("microsoft_teams", "failure"),
      channelPost("microsoft_teams", "failure"),
      channelPost("microsoft_teams", "failure"),
    ]);
    expect(sendDurationCalls).toEqual([]);
  });

  test("the project's chats could not be listed: the channels count as they went, each chat a failure", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getChatsForProject")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      send({
        channelIds: ["19:a@thread.tacv2"],
        chatIds: [CHAT.id, "19:chat-2@thread.v2"],
      }),
    ).rejects.toThrow("database is down");

    expect(outcomes()).toEqual(["success", "failure", "failure"]);
    // The channel's post was made and timed; the chats were never tried.
    expect(sendDurationCalls).toHaveLength(1);
  });
});

describe("MattermostUtil.sendMessage: a post a channel", () => {
  const SERVER: string = "https://chat.example.com";
  const TEAM_ID: string = "t".repeat(26);
  const BOT_ID: string = "b".repeat(26);
  const PUBLIC_CHANNEL_ID: string = "c".repeat(26);
  const PRIVATE_CHANNEL_ID: string = "p".repeat(26);
  const OTHER_CHANNEL_ID: string = "o".repeat(26);
  const POST_ID: string = "m".repeat(26);

  const AUTH_TOKEN: string = MattermostConnection.toAuthToken({
    serverUrl: SERVER,
    accessToken: "abcdefghijklmnopqrstuvwxyz",
    teamId: TEAM_ID,
    botUserId: BOT_ID,
  });

  function mattermostChannel(id: string, type: string = "O"): MattermostChannel {
    return {
      id: id,
      name: `channel-${id.substring(0, 1)}`,
      displayName: `Channel ${id.substring(0, 1)}`,
      type: type,
      workspaceType: WorkspaceType.Mattermost,
    };
  }

  const CHANNELS: Record<string, MattermostChannel> = {
    [PUBLIC_CHANNEL_ID]: mattermostChannel(PUBLIC_CHANNEL_ID),
    [PRIVATE_CHANNEL_ID]: mattermostChannel(PRIVATE_CHANNEL_ID, "P"),
    [OTHER_CHANNEL_ID]: mattermostChannel(OTHER_CHANNEL_ID),
  };

  let posted: Array<string>;

  beforeEach(() => {
    posted = [];

    jest
      .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
      .mockResolvedValue(undefined);
    jest
      .spyOn(MattermostUtil, "getChannel")
      .mockImplementation(
        async (data: { channelId: string }): Promise<MattermostChannel> => {
          const found: MattermostChannel | undefined = CHANNELS[data.channelId];

          if (!found) {
            throw new BadDataException("The Mattermost channel was not found.");
          }

          return found;
        },
      );
    jest
      .spyOn(MattermostUtil, "findChannelByName")
      .mockImplementation(
        async (data: {
          channelName: string;
        }): Promise<MattermostChannel | null> => {
          if (data.channelName === "unreadable") {
            throw new BadDataException("Mattermost could not be reached.");
          }

          return data.channelName === "incidents"
            ? CHANNELS[PUBLIC_CHANNEL_ID]!
            : null;
        },
      );
    jest
      .spyOn(API, "post")
      .mockImplementation((async (args: {
        url: URL;
        data: JSONObject;
      }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const channelId: string = args.data["channel_id"] as string;

        posted.push(channelId);

        if (channelId === PRIVATE_CHANNEL_ID) {
          return new HTTPErrorResponse(
            403,
            {
              id: "api.context.permissions.app_error",
              message: "You do not have the appropriate permissions.",
            },
            {},
          );
        }

        return new HTTPResponse<JSONObject>(200, { id: POST_ID }, {});
      }) as never);
  });

  function send(
    data: {
      channelNames?: Array<string> | undefined;
      channelIds?: Array<string> | undefined;
      exceptChannelIds?: Array<string> | undefined;
    },
    authToken: string = AUTH_TOKEN,
  ): Promise<WorkspaceSendMessageResponse> {
    return MattermostUtil.sendMessage({
      workspaceMessagePayload: payloadFor({
        workspaceType: WorkspaceType.Mattermost,
        channelNames: data.channelNames,
        channelIds: data.channelIds,
        exceptChannelIds: data.exceptChannelIds,
      }),
      authToken: authToken,
      userId: "",
      projectId: PROJECT_ID,
    });
  }

  test("each channel posted in: one success, timed - a channel named twice is posted in, and counted, once", async () => {
    const response: WorkspaceSendMessageResponse = await send({
      channelNames: ["incidents"],
      channelIds: [PUBLIC_CHANNEL_ID, OTHER_CHANNEL_ID],
    });

    expect(posted).toEqual([PUBLIC_CHANNEL_ID, OTHER_CHANNEL_ID]);
    expect(response.threads).toHaveLength(2);
    expect(counted()).toEqual([
      channelPost("mattermost", "success"),
      channelPost("mattermost", "success"),
    ]);
    expect(timed()).toEqual([
      channelPost("mattermost", "success"),
      channelPost("mattermost", "success"),
    ]);
  });

  test("a private channel the bot is not in: a failure, timed", async () => {
    const response: WorkspaceSendMessageResponse = await send({
      channelIds: [PRIVATE_CHANNEL_ID],
    });

    expect(response.errors?.[0]?.error).toContain("Add the bot");
    expect(counted()).toEqual([channelPost("mattermost", "failure")]);
    expect(timed()).toEqual([channelPost("mattermost", "failure")]);
  });

  test("a channel name that names nothing, or could not be read: a failure each, untimed", async () => {
    await send({
      channelNames: ["missing", "unreadable"],
      channelIds: [OTHER_CHANNEL_ID],
    });

    expect(outcomes()).toEqual(["failure", "failure", "success"]);
    expect(sendDurationCalls).toHaveLength(1);
  });

  test("a channel id that could not be read: a failure, untimed", async () => {
    await send({ channelIds: ["z".repeat(26)] });

    expect(posted).toEqual([]);
    expect(counted()).toEqual([channelPost("mattermost", "failure")]);
    expect(sendDurationCalls).toEqual([]);
  });

  test("a channel the message is not for is neither posted in nor counted", async () => {
    await send({
      channelIds: [PUBLIC_CHANNEL_ID, OTHER_CHANNEL_ID],
      exceptChannelIds: [OTHER_CHANNEL_ID],
    });

    expect(posted).toEqual([PUBLIC_CHANNEL_ID]);
    expect(outcomes()).toEqual(["success"]);
  });

  test("a connection that is no connection: each channel the message names is a failure, and the error is passed on", async () => {
    await expect(
      send(
        { channelNames: ["incidents"], channelIds: [PUBLIC_CHANNEL_ID] },
        "not a connection",
      ),
    ).rejects.toThrow(BadDataException);

    expect(posted).toEqual([]);
    expect(counted()).toEqual([
      channelPost("mattermost", "failure"),
      channelPost("mattermost", "failure"),
    ]);
    expect(sendDurationCalls).toEqual([]);
  });
});

describe("incoming webhooks: a status page subscriber's, the operator's", () => {
  let apiPost: jest.SpiedFunction<typeof API.post>;

  beforeEach(() => {
    apiPost = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never,
      );
    jest
      .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
      .mockResolvedValue(undefined);
  });

  describe("Slack", () => {
    test("Slack took it: a success, timed, through the project's webhook", async () => {
      await SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(SLACK_WEBHOOK),
        text: "Checkout API is down",
      });

      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(counted()).toEqual([
        channelPost("slack", "success", "incoming_webhook"),
      ]);
      expect(timed()).toEqual([
        channelPost("slack", "success", "incoming_webhook"),
      ]);
    });

    test("Slack refused it: a failure, and the refusal is returned as before", async () => {
      apiPost.mockResolvedValue(
        new HTTPErrorResponse(
          404,
          { error: "no_service" },
          {},
        ) as unknown as never,
      );

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await SlackUtil.sendMessageToChannelViaIncomingWebhook({
          url: URL.fromString(SLACK_WEBHOOK),
          text: "Checkout API is down",
        });

      expect(response).toBeInstanceOf(HTTPErrorResponse);
      expect(counted()).toEqual([
        channelPost("slack", "failure", "incoming_webhook"),
      ]);
    });

    test("an address that is not a Slack webhook's: a failure, never posted, and thrown as before", async () => {
      await expect(
        SlackUtil.sendMessageToChannelViaIncomingWebhook({
          url: URL.fromString("https://intranet.example/services/hook"),
          text: "Checkout API is down",
        }),
      ).rejects.toThrow("https://hooks.slack.com/services/");

      expect(apiPost).not.toHaveBeenCalled();
      expect(counted()).toEqual([
        channelPost("slack", "failure", "incoming_webhook"),
      ]);
    });

    test("a workflow's own post is made, and not counted", async () => {
      await SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(SLACK_WEBHOOK),
        text: "Deploy finished",
        isNotification: false,
      });

      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(sendCounterCalls).toEqual([]);
      expect(sendDurationCalls).toEqual([]);
    });

    test("the operator's notices go through the installation's own webhook: global", async () => {
      await OperatorSlackNotice.post({
        webhookUrl: SLACK_WEBHOOK,
        text: "*New OneUptime User:*",
        about: "user creation",
      });

      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(counted()).toEqual([
        channelPost("slack", "success", "incoming_webhook", "global"),
      ]);
    });

    test("an operator's notice Slack refused: a failure, global - and still never thrown", async () => {
      apiPost.mockRejectedValue(new Error("socket hang up"));

      await expect(
        OperatorSlackNotice.post({
          webhookUrl: SLACK_WEBHOOK,
          text: "*New OneUptime User:*",
          about: "user creation",
        }),
      ).resolves.toBeUndefined();

      expect(counted()).toEqual([
        channelPost("slack", "failure", "incoming_webhook", "global"),
      ]);
    });
  });

  describe("Microsoft Teams", () => {
    test("Teams took it: a success, timed", async () => {
      await MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(TEAMS_WEBHOOK),
        text: "Checkout API is down",
      });

      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(counted()).toEqual([
        channelPost("microsoft_teams", "success", "incoming_webhook"),
      ]);
      expect(sendDurationCalls).toHaveLength(1);
    });

    test("Teams refused it: a failure, and the refusal is thrown as before", async () => {
      apiPost.mockResolvedValue(
        new HTTPErrorResponse(400, { error: "bad card" }, {}) as unknown as never,
      );

      await expect(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
          url: URL.fromString(TEAMS_WEBHOOK),
          text: "Checkout API is down",
        }),
      ).rejects.toBeInstanceOf(HTTPErrorResponse);

      expect(counted()).toEqual([
        channelPost("microsoft_teams", "failure", "incoming_webhook"),
      ]);
    });

    test("an address that is not a Teams webhook's: a failure, never posted", async () => {
      await expect(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
          url: URL.fromString("http://169.254.169.254/?x=office.com"),
          text: "Checkout API is down",
        }),
      ).rejects.toThrow(BadDataException);

      expect(apiPost).not.toHaveBeenCalled();
      expect(outcomes()).toEqual(["failure"]);
    });
  });

  describe("Mattermost", () => {
    test("Mattermost took it: a success, timed", async () => {
      await MattermostUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(MATTERMOST_WEBHOOK),
        text: "Checkout API is down",
      });

      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(counted()).toEqual([
        channelPost("mattermost", "success", "incoming_webhook"),
      ]);
      expect(sendDurationCalls).toHaveLength(1);
    });

    test("Mattermost refused it: a failure, and the refusal is returned as before", async () => {
      apiPost.mockResolvedValue(
        new HTTPErrorResponse(
          400,
          { message: "Invalid webhook" },
          {},
        ) as unknown as never,
      );

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await MattermostUtil.sendMessageToChannelViaIncomingWebhook({
          url: URL.fromString(MATTERMOST_WEBHOOK),
          text: "Checkout API is down",
        });

      expect(response).toBeInstanceOf(HTTPErrorResponse);
      expect(outcomes()).toEqual(["failure"]);
    });

    test("an address OneUptime may not reach: a failure, never posted", async () => {
      jest
        .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
        .mockRejectedValue(
          new BadDataException("Mattermost webhook URL is not allowed."),
        );

      await expect(
        MattermostUtil.sendMessageToChannelViaIncomingWebhook({
          url: URL.fromString("http://10.0.0.5/hooks/abc"),
          text: "Checkout API is down",
        }),
      ).rejects.toThrow("not allowed");

      expect(apiPost).not.toHaveBeenCalled();
      expect(counted()).toEqual([
        channelPost("mattermost", "failure", "incoming_webhook"),
      ]);
    });
  });
});
