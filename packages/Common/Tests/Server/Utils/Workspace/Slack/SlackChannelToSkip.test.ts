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
} from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceMessagePayload from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A CHANNEL A MESSAGE IS NOT POSTED IN (WorkspaceMessagePayload.exceptChannelIds).
 *
 * A Slack message saved as a note is already in its channel: the note's
 * entry is posted to the record's other channels, not back there. A rule's
 * channel is named by its name, so SlackUtil leaves the channel out once
 * the name is resolved to its id.
 */

const INC_CHANNEL: WorkspaceChannel = {
  id: "C0INC8",
  name: "inc-inc-8",
  workspaceType: WorkspaceType.Slack,
};
const OPS_CHANNEL: WorkspaceChannel = {
  id: "C0OPS",
  name: "ops",
  workspaceType: WorkspaceType.Slack,
};

let posted: Array<JSONObject>;

beforeEach(() => {
  posted = [];

  jest
    .spyOn(SlackUtil, "getWorkspaceChannelByName")
    .mockImplementation((async (data: { channelName: string }) => {
      return data.channelName === INC_CHANNEL.name ? INC_CHANNEL : OPS_CHANNEL;
    }) as never);
  jest
    .spyOn(SlackUtil, "getWorkspaceChannelFromChannelId")
    .mockImplementation((async (data: { channelId: string }) => {
      return data.channelId === INC_CHANNEL.id ? INC_CHANNEL : OPS_CHANNEL;
    }) as never);

  jest.spyOn(API, "post").mockImplementation((async (data: {
    url: { toString: () => string };
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject>> => {
    if (data.url.toString().endsWith("chat.postMessage")) {
      posted.push(data.data);
    }

    const answer: JSONObject = {
      ok: true,
      ts: "1760000000.000001",
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
    channelNames: [],
    channelIds: [],
    messageBlocks: [
      {
        _type: "WorkspacePayloadMarkdown",
        text: "📄 **Aidil Rahman** posted **private note** via Slack",
      },
    ],
    ...overrides,
  } as WorkspaceMessagePayload;
}

describe("SlackUtil.sendMessage - a channel to skip", () => {
  test("named by its name or its id, it is not posted to; the others are", async () => {
    const response: WorkspaceSendMessageResponse = await SlackUtil.sendMessage({
      workspaceMessagePayload: payload({
        channelNames: ["#inc-inc-8", "ops"],
        channelIds: [INC_CHANNEL.id],
        exceptChannelIds: [INC_CHANNEL.id],
      }),
      authToken: "xoxb-token",
      userId: "",
      projectId: ObjectID.generate(),
    });

    expect(
      posted.map((body: JSONObject): unknown => {
        return body["channel"];
      }),
    ).toEqual([OPS_CHANNEL.id]);
    expect(
      response.threads.map((thread: { channel: WorkspaceChannel }) => {
        return thread.channel.id;
      }),
    ).toEqual([OPS_CHANNEL.id]);
  });

  test("with nothing to skip, every channel is posted to", async () => {
    await SlackUtil.sendMessage({
      workspaceMessagePayload: payload({
        channelNames: ["ops"],
        channelIds: [INC_CHANNEL.id],
      }),
      authToken: "xoxb-token",
      userId: "",
      projectId: ObjectID.generate(),
    });

    expect(
      posted.map((body: JSONObject): unknown => {
        return body["channel"];
      }),
    ).toEqual([OPS_CHANNEL.id, INC_CHANNEL.id]);
  });
});
