import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import { WorkspaceDirectMessageLocation } from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * WHERE A SLACK DIRECT MESSAGE LANDED (#6317), SO IT CAN BE EDITED LATER.
 *
 * A direct message from the app is posted to the member's id (U...), and
 * Slack opens - or finds - the direct message channel for it (D...). An
 * edit of the message (chat.update) has to name that channel: Slack takes no
 * member id there. So a sent direct message says the channel Slack posted
 * in, with the message's ts - what a public note's approval message is kept
 * by, to be replaced once the note is decided.
 */

const MEMBER_ID: string = "U0BOB12345";
const DIRECT_CHANNEL: string = "D0BOBDIRECT";
const TS: string = "1760000000.000777";

interface SlackCall {
  method: string;
  body: JSONObject;
}

let calls: Array<SlackCall>;
let answer: (method: string, body: JSONObject) => JSONObject;

function blocks(): Array<WorkspaceMessageBlock> {
  const block: WorkspacePayloadMarkdown = {
    _type: "WorkspacePayloadMarkdown",
    text: "📝 **Approval needed: public note on Incident INC-42**",
  };

  return [block];
}

beforeEach(() => {
  calls = [];
  answer = (_method: string, body: JSONObject): JSONObject => {
    return {
      ok: true,
      ts: TS,
      channel: body["channel"] === MEMBER_ID ? DIRECT_CHANNEL : body["channel"],
    };
  };

  jest.spyOn(API, "post").mockImplementation((async (data: {
    url: { toString: () => string };
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject>> => {
    const method: string = data.url.toString().split("/api/")[1] || "";
    calls.push({ method: method, body: data.data });

    const json: JSONObject = answer(method, data.data);

    return {
      jsonData: json,
      data: json,
    } as unknown as HTTPResponse<JSONObject>;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SlackUtil.sendDirectMessageToUser", () => {
  test("posts to the member, and says the direct message channel Slack posted in and the message's ts", async () => {
    const sent: WorkspaceDirectMessageLocation | null =
      await SlackUtil.sendDirectMessageToUser({
        authToken: "xoxb-project-token",
        workspaceUserId: MEMBER_ID,
        messageBlocks: blocks(),
        text: "Approval needed: public note on Incident INC-42",
      });

    expect(
      calls.map((call: SlackCall): string => {
        return call.method;
      }),
    ).toEqual(["chat.postMessage"]);
    expect(calls[0]!.body["channel"]).toBe(MEMBER_ID);
    expect(sent).toEqual({ channelId: DIRECT_CHANNEL, messageId: TS });
  });

  test("an answer that names no channel: the channel it was posted to", async () => {
    answer = (): JSONObject => {
      return { ok: true, ts: TS };
    };

    expect(
      await SlackUtil.sendDirectMessageToUser({
        authToken: "xoxb-project-token",
        workspaceUserId: MEMBER_ID,
        messageBlocks: blocks(),
      }),
    ).toEqual({ channelId: MEMBER_ID, messageId: TS });
  });

  test("an answer with no ts: nowhere to say, so nothing is kept", async () => {
    answer = (): JSONObject => {
      return { ok: true, channel: DIRECT_CHANNEL };
    };

    expect(
      await SlackUtil.sendDirectMessageToUser({
        authToken: "xoxb-project-token",
        workspaceUserId: MEMBER_ID,
        messageBlocks: blocks(),
      }),
    ).toBeNull();
  });

  test("a refusal is thrown, as before", async () => {
    answer = (): JSONObject => {
      return { ok: false, error: "user_not_found" };
    };

    await expect(
      SlackUtil.sendDirectMessageToUser({
        authToken: "xoxb-project-token",
        workspaceUserId: MEMBER_ID,
        messageBlocks: blocks(),
      }),
    ).rejects.toThrow("user_not_found");
  });
});

describe("SlackUtil.sendPayloadBlocksToChannel", () => {
  test("a channel's message: the channel it was posted to, as Slack names it", async () => {
    const thread: { channel: { id: string; name: string }; threadId: string } =
      await SlackUtil.sendPayloadBlocksToChannel({
        authToken: "xoxb-project-token",
        workspaceChannel: {
          id: "C0INC42",
          name: "incident-42",
          workspaceType: WorkspaceType.Slack,
        },
        blocks: [],
      });

    expect(thread.channel.id).toBe("C0INC42");
    expect(thread.channel.name).toBe("incident-42");
    expect(thread.threadId).toBe(TS);
  });
});

describe("SlackUtil.updateMessage of a direct message", () => {
  test("names the direct message channel it landed in, and its ts", async () => {
    await SlackUtil.updateMessage({
      authToken: "xoxb-project-token",
      projectId: ObjectID.generate(),
      location: { channelId: DIRECT_CHANNEL },
      messageId: TS,
      messageBlocks: blocks(),
      text: "This public note was approved",
    });

    expect(calls[0]!.method).toBe("chat.update");
    expect(calls[0]!.body["channel"]).toBe(DIRECT_CHANNEL);
    expect(calls[0]!.body["ts"]).toBe(TS);
    expect(calls[0]!.body["text"]).toBe("This public note was approved");
  });
});
