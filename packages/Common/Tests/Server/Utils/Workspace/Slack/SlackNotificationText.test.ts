import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
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
 * WHAT A SLACK NOTIFICATION SAYS OF A ONEUPTIME MESSAGE.
 *
 * A message of blocks says nothing in a push notification, a preview or to
 * a screen reader unless it carries a top-level `text`: the on-call alarm -
 * posted for somebody to act - buzzed a phone with nothing to read. A
 * payload's `text` (WorkspaceMessagePayload.text) is now posted as that
 * text, and an edit carries it too. It is plain text, so it is escaped as
 * Slack reads text: a person or policy named "<!channel>" would otherwise
 * notify the whole channel. A payload without one is posted as it always
 * was.
 */

const CHANNEL_ID: string = "C0INC8";
const PROJECT_ID: ObjectID = ObjectID.generate();

interface SlackCall {
  method: string;
  body: JSONObject;
}

let calls: Array<SlackCall>;

beforeEach(() => {
  calls = [];

  jest.spyOn(API, "post").mockImplementation((async (data: {
    url: { toString: () => string };
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject>> => {
    const method: string = data.url.toString().split("/api/")[1] || "";
    calls.push({ method: method, body: data.data });

    const answer: JSONObject =
      method === "conversations.info"
        ? { ok: true, channel: { id: data.data["channel"], name: "inc-8" } }
        : { ok: true, ts: "1760000000.000001", channel: data.data["channel"] };

    return {
      jsonData: answer,
      data: answer,
    } as unknown as HTTPResponse<JSONObject>;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function payload(text?: string | undefined): WorkspaceMessagePayload {
  const block: WorkspacePayloadMarkdown = {
    _type: "WorkspacePayloadMarkdown",
    text: "⚠️ **PolicyX** paged nobody at escalation rule 3 of 3 (third)",
  };

  const message: WorkspaceMessagePayload = {
    _type: "WorkspaceMessagePayload",
    workspaceType: WorkspaceType.Slack,
    channelNames: [],
    channelIds: [CHANNEL_ID],
    messageBlocks: [block],
  };

  if (text !== undefined) {
    message.text = text;
  }

  return message;
}

function posts(): Array<JSONObject> {
  return calls
    .filter((call: SlackCall): boolean => {
      return call.method === "chat.postMessage";
    })
    .map((call: SlackCall): JSONObject => {
      return call.body;
    });
}

describe("SlackUtil - a message's notification text", () => {
  test("a message posted with a notification line carries it as Slack's top-level text", async () => {
    await SlackUtil.sendMessage({
      workspaceMessagePayload: payload(
        "PolicyX paged nobody at escalation rule 3 of 3 (third) for Incident INC-8",
      ),
      authToken: "xoxb-token",
      userId: "",
      projectId: PROJECT_ID,
    });

    expect(posts()).toHaveLength(1);
    expect(posts()[0]!["text"]).toBe(
      "PolicyX paged nobody at escalation rule 3 of 3 (third) for Incident INC-8",
    );
    expect(posts()[0]!["channel"]).toBe(CHANNEL_ID);
    expect((posts()[0]!["blocks"] as Array<JSONObject>).length).toBe(1);
  });

  test("a message without one is posted as it always was: no top-level text", async () => {
    await SlackUtil.sendMessage({
      workspaceMessagePayload: payload(),
      authToken: "xoxb-token",
      userId: "",
      projectId: PROJECT_ID,
    });

    expect(posts()).toHaveLength(1);
    expect(posts()[0]!).not.toHaveProperty("text");
  });

  test("REGRESSION: a name in the text cannot notify the channel or become a link - it is escaped as Slack reads text", async () => {
    await SlackUtil.sendMessage({
      workspaceMessagePayload: payload(
        "<!channel> & <https://evil.test|PolicyX> is paging for Incident INC-8",
      ),
      authToken: "xoxb-token",
      userId: "",
      projectId: PROJECT_ID,
    });

    expect(posts()[0]!["text"]).toBe(
      "&lt;!channel&gt; &amp; &lt;https://evil.test|PolicyX&gt; is paging for Incident INC-8",
    );
  });

  test("an edit carries its text escaped the same way", async () => {
    await SlackUtil.updateMessage({
      authToken: "xoxb-token",
      projectId: PROJECT_ID,
      location: { channelId: CHANNEL_ID },
      messageId: "1760000000.000001",
      messageBlocks: payload().messageBlocks,
      text: "<!here> acknowledged Incident INC-8",
    });

    const update: SlackCall | undefined = calls.find((call: SlackCall) => {
      return call.method === "chat.update";
    });

    expect(update?.body["text"]).toBe(
      "&lt;!here&gt; acknowledged Incident INC-8",
    );
    expect(update?.body["ts"]).toBe("1760000000.000001");
  });

  test("an edit without text sends none", async () => {
    await SlackUtil.updateMessage({
      authToken: "xoxb-token",
      projectId: PROJECT_ID,
      location: { channelId: CHANNEL_ID },
      messageId: "1760000000.000001",
      messageBlocks: payload().messageBlocks,
    });

    const update: SlackCall | undefined = calls.find((call: SlackCall) => {
      return call.method === "chat.update";
    });

    expect(update?.body).not.toHaveProperty("text");
  });

  test("getNotificationText escapes exactly what Slack reads in text: &, < and >", () => {
    expect(SlackUtil.getNotificationText("A & B <x> 'y' \"z\" *bold*")).toBe(
      "A &amp; B &lt;x&gt; 'y' \"z\" *bold*",
    );
  });
});
