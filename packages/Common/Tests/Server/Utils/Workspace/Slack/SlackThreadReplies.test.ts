import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A REPLY IN A RECORD'S THREAD (WorkspaceMessagePayload.threadTsByChannelId).
 *
 * Where a rule keeps a record's messages in one thread, SlackUtil posts the
 * message as a reply (thread_ts) in each channel the payload has a thread
 * for - looked up by the id the channel's name resolved to - and, for a
 * state change (alsoSendToChannel), shows it in the channel too
 * (reply_broadcast). A reply Slack refuses is that channel's error, as any
 * refused post is: WorkspaceRecordThreads posts it again on its own.
 */

const OPS_CHANNEL: WorkspaceChannel = {
  id: "C0OPS",
  name: "ops",
  workspaceType: WorkspaceType.Slack,
};
const SRE_CHANNEL: WorkspaceChannel = {
  id: "C0SRE",
  name: "sre",
  workspaceType: WorkspaceType.Slack,
};

const ROOT_TS: string = "1760000000.000100";

let posted: Array<JSONObject>;
// Slack's error for a post with thread_ts, when it refuses replies.
let refuseRepliesWith: string | null;

beforeEach(() => {
  posted = [];
  refuseRepliesWith = null;

  jest
    .spyOn(SlackUtil, "getWorkspaceChannelByName")
    .mockImplementation((async (data: { channelName: string }) => {
      return data.channelName === SRE_CHANNEL.name ? SRE_CHANNEL : OPS_CHANNEL;
    }) as never);

  jest.spyOn(API, "post").mockImplementation((async (data: {
    url: { toString: () => string };
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject>> => {
    if (data.url.toString().endsWith("chat.postMessage")) {
      posted.push(data.data);
    }

    const answer: JSONObject =
      refuseRepliesWith && data.data["thread_ts"]
        ? { ok: false, error: refuseRepliesWith }
        : {
            ok: true,
            ts: `1760000001.00000${posted.length}`,
            channel: data.data["channel"],
          };

    return {
      jsonData: answer,
      data: answer,
    } as unknown as HTTPResponse<JSONObject>;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function payload(
  overrides: Partial<WorkspaceMessagePayload>,
): WorkspaceMessagePayload {
  return {
    _type: "WorkspaceMessagePayload",
    workspaceType: WorkspaceType.Slack,
    channelNames: ["#ops"],
    channelIds: [],
    messageBlocks: [
      {
        _type: "WorkspacePayloadMarkdown",
        text: "🔄 Changed **Incident INC-42 State** to **Acknowledged**",
      },
    ],
    ...overrides,
  } as WorkspaceMessagePayload;
}

async function send(
  workspaceMessagePayload: WorkspaceMessagePayload,
): Promise<WorkspaceSendMessageResponse> {
  return await SlackUtil.sendMessage({
    workspaceMessagePayload: workspaceMessagePayload,
    authToken: "xoxb-token",
    userId: "",
    projectId: ObjectID.generate(),
  });
}

describe("SlackUtil.sendMessage - a reply in a record's thread", () => {
  test("no thread: a message of its own, as before - even when it asks to be shown in the channel", async () => {
    const response: WorkspaceSendMessageResponse = await send(
      payload({ alsoSendToChannel: true }),
    );

    expect(posted).toHaveLength(1);
    expect(posted[0]).not.toHaveProperty("thread_ts");
    expect(posted[0]).not.toHaveProperty("reply_broadcast");
    expect(response.threads[0]).not.toHaveProperty("parentThreadId");
  });

  test("the thread of the channel's resolved id: posted there as a reply, and said so", async () => {
    const response: WorkspaceSendMessageResponse = await send(
      payload({ threadTsByChannelId: { [OPS_CHANNEL.id]: ROOT_TS } }),
    );

    expect(posted).toHaveLength(1);
    expect(posted[0]!["channel"]).toBe(OPS_CHANNEL.id);
    expect(posted[0]!["thread_ts"]).toBe(ROOT_TS);
    expect(posted[0]).not.toHaveProperty("reply_broadcast");

    const thread: WorkspaceThread = response.threads[0]!;
    expect(thread.threadId).toBe("1760000001.000001");
    expect(thread.parentThreadId).toBe(ROOT_TS);
  });

  test("a thread looked up by the channel's name is not one: only the id the name resolved to counts", async () => {
    await send(
      payload({
        threadTsByChannelId: { "#ops": ROOT_TS, ops: ROOT_TS },
      }),
    );

    expect(posted[0]).not.toHaveProperty("thread_ts");
  });

  test("each channel in its own thread; a channel with none gets a message of its own", async () => {
    await send(
      payload({
        channelNames: ["#ops", "#sre"],
        threadTsByChannelId: { [SRE_CHANNEL.id]: ROOT_TS },
      }),
    );

    expect(
      posted.map((body: JSONObject): [unknown, unknown] => {
        return [body["channel"], body["thread_ts"]];
      }),
    ).toEqual([
      [OPS_CHANNEL.id, undefined],
      [SRE_CHANNEL.id, ROOT_TS],
    ]);
  });

  test("a state change in a thread is shown in the channel too (reply_broadcast)", async () => {
    await send(
      payload({
        threadTsByChannelId: { [OPS_CHANNEL.id]: ROOT_TS },
        alsoSendToChannel: true,
      }),
    );

    expect(posted[0]!["thread_ts"]).toBe(ROOT_TS);
    expect(posted[0]!["reply_broadcast"]).toBe(true);
  });

  test("a message too long for one post: every part is in the thread, only the first is shown in the channel", async () => {
    const lines: Array<WorkspacePayloadMarkdown> = [];

    for (
      let index: number = 0;
      index < SlackUtil.MAX_BLOCKS_PER_MESSAGE + 10;
      index++
    ) {
      lines.push({
        _type: "WorkspacePayloadMarkdown",
        text: `Affected host ${index}`,
      });
    }

    const response: WorkspaceSendMessageResponse = await send(
      payload({
        messageBlocks: lines,
        threadTsByChannelId: { [OPS_CHANNEL.id]: ROOT_TS },
        alsoSendToChannel: true,
      }),
    );

    expect(posted.length).toBeGreaterThan(1);
    for (const body of posted) {
      expect(body["thread_ts"]).toBe(ROOT_TS);
    }
    expect(posted[0]!["reply_broadcast"]).toBe(true);
    for (const body of posted.slice(1)) {
      expect(body).not.toHaveProperty("reply_broadcast");
    }

    expect(response.threads[0]!.parentThreadId).toBe(ROOT_TS);
  });

  test("a reply Slack refuses is that channel's error, and is not posted again here", async () => {
    refuseRepliesWith = "thread_not_found";

    const response: WorkspaceSendMessageResponse = await send(
      payload({ threadTsByChannelId: { [OPS_CHANNEL.id]: ROOT_TS } }),
    );

    expect(posted).toHaveLength(1);
    expect(posted[0]!["thread_ts"]).toBe(ROOT_TS);
    expect(response.threads).toEqual([]);
    expect(response.errors).toHaveLength(1);
    expect(response.errors![0]!.channel.id).toBe(OPS_CHANNEL.id);
    expect(response.errors![0]!.error).toContain("thread_not_found");
  });
});
