import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import API from "../../../../../Utils/API";
import logger from "../../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import SlackActionAnswer, {
  SlackAnswerDelivery,
  SlackAnswerPlace,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/Answer";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import { WorkspaceAnswer } from "../../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import { WorkspaceModalBlock } from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * WHERE A PRESS IN SLACK IS ANSWERED, REQUEST BY REQUEST.
 *
 * Customer feedback #1: somebody pressed Acknowledge in an incident's
 * channel, "nothing happens on the channel", and the answers - twice - went
 * to the app's direct messages, which they never opened. An answer now goes
 * where the press was, as a message only the person who pressed sees:
 *
 *   1. the press's response_url (it reaches the channel even when OneUptime
 *      is not in it), never replacing the message the button is on;
 *   2. chat.postEphemeral, in the channel and the thread of the press;
 *   3. a modal, for a shortcut, which has no channel;
 *   4. the direct message only when none of these could be sent.
 *
 * These pin exactly what Slack is asked to post at each step, and that an
 * address that is not one of Slack's response URLs is never posted to.
 */

const PROJECT_TOKEN: string = "xoxb-project-token";
const SLACK_USER: string = "U0NITIN";
const RESPONSE_URL: string =
  "https://hooks.slack.com/actions/T0TEAM/1234567890/abcdefABCDEF";
const CONNECT_URL: string = `https://oneuptime.test/dashboard/${ObjectID.generate().toString()}/user-settings/slack-integration?connect=${"a".repeat(43)}`;

const ANSWER: WorkspaceAnswer = {
  markdown:
    "🔗 **Connect your Slack account to acknowledge this incident.** It takes one click, and OneUptime acknowledges it for you as soon as you're connected.",
  text: "Connect your Slack account to acknowledge this incident",
};

/*
 * The section Slack shows the answer in: its Markdown as Slack writes it -
 * bold in single asterisks, fenced by zero-width spaces so Slack reads them
 * next to any character.
 */
const ANSWER_SECTION: JSONObject = {
  type: "section",
  text: {
    type: "mrkdwn",
    text: "🔗 ​*Connect your Slack account to acknowledge this incident.*​ It takes one click, and OneUptime acknowledges it for you as soon as you're connected.\n",
  },
};

const CONNECT_BUTTON: JSONObject = {
  type: "button",
  text: { type: "plain_text", text: "Connect Slack account", emoji: true },
  value: "connect",
  action_id: "ConnectSlackAccount",
  url: CONNECT_URL,
  style: "primary",
};

interface SlackCall {
  url: string;
  data: JSONObject;
  authorization: string | undefined;
}

let calls: Array<SlackCall>;

// How Slack answers each address; ok unless a test says otherwise.
let slackAnswers: Map<
  string,
  () => HTTPResponse<JSONObject> | HTTPErrorResponse
>;

function ok(body: JSONObject = { ok: true }): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, body, {});
}

beforeEach(() => {
  calls = [];
  slackAnswers = new Map();

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data: JSONObject;
    headers?: JSONObject;
  }) => {
    const url: string = options.url.toString();

    calls.push({
      url: url,
      data: options.data,
      authorization: options.headers?.["Authorization"] as string | undefined,
    });

    const answer:
      | (() => HTTPResponse<JSONObject> | HTTPErrorResponse)
      | undefined = slackAnswers.get(url);

    return answer ? answer() : ok();
  }) as never);

  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
  jest.spyOn(logger, "debug").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function place(overrides?: Partial<SlackAnswerPlace>): SlackAnswerPlace {
  return {
    projectAuthToken: PROJECT_TOKEN,
    slackUserId: SLACK_USER,
    slackChannelId: "C0INC2",
    slackThreadTs: "1760000000.000100",
    responseUrl: RESPONSE_URL,
    ...overrides,
  };
}

function urls(): Array<string> {
  return calls.map((call: SlackCall): string => {
    return call.url;
  });
}

describe("SlackActionAnswer.answer", () => {
  test("a button's press is answered at its response_url: only the presser sees it, and the message it is on stays", async () => {
    const delivery: SlackAnswerDelivery = await SlackActionAnswer.answer({
      place: place(),
      answer: ANSWER,
      connectUrl: URL.fromString(CONNECT_URL),
    });

    expect(delivery).toBe(SlackAnswerDelivery.ResponseUrl);
    expect(calls).toEqual([
      {
        url: RESPONSE_URL,
        data: {
          response_type: "ephemeral",
          replace_original: false,
          blocks: [
            ANSWER_SECTION,
            { type: "actions", elements: [CONNECT_BUTTON] },
          ],
          text: "Connect your Slack account to acknowledge this incident",
        },
        // A response_url is its own credential: no token goes with it.
        authorization: undefined,
      },
    ]);
  });

  test("when the response_url is spent or expired, the answer goes to the channel and thread of the press", async () => {
    slackAnswers.set(RESPONSE_URL, () => {
      return ok({ ok: false, error: "expired_url" });
    });

    const delivery: SlackAnswerDelivery = await SlackActionAnswer.answer({
      place: place(),
      answer: ANSWER,
      connectUrl: URL.fromString(CONNECT_URL),
    });

    expect(delivery).toBe(SlackAnswerDelivery.Ephemeral);
    expect(urls()).toEqual([
      RESPONSE_URL,
      "https://slack.com/api/chat.postEphemeral",
    ]);
    expect(calls[1]).toEqual({
      url: "https://slack.com/api/chat.postEphemeral",
      data: {
        channel: "C0INC2",
        user: SLACK_USER,
        blocks: [
          ANSWER_SECTION,
          { type: "actions", elements: [CONNECT_BUTTON] },
        ],
        thread_ts: "1760000000.000100",
        text: "Connect your Slack account to acknowledge this incident",
      },
      authorization: `Bearer ${PROJECT_TOKEN}`,
    });
  });

  test("a form's submission - no response_url - is answered in the channel it was opened from", async () => {
    const delivery: SlackAnswerDelivery = await SlackActionAnswer.answer({
      place: place({ responseUrl: undefined, slackThreadTs: undefined }),
      answer: { markdown: "Note added.", text: "Note added." },
    });

    expect(delivery).toBe(SlackAnswerDelivery.Ephemeral);
    expect(calls).toEqual([
      {
        url: "https://slack.com/api/chat.postEphemeral",
        data: {
          channel: "C0INC2",
          user: SLACK_USER,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "Note added.\n" },
            },
          ],
          text: "Note added.",
        },
        authorization: `Bearer ${PROJECT_TOKEN}`,
      },
    ]);
  });

  test("a shortcut, which has no channel, is answered in a modal", async () => {
    const delivery: SlackAnswerDelivery = await SlackActionAnswer.answer({
      place: {
        projectAuthToken: PROJECT_TOKEN,
        slackUserId: SLACK_USER,
        triggerId: "trigger-1",
      },
      answer: ANSWER,
      connectUrl: URL.fromString(CONNECT_URL),
    });

    expect(delivery).toBe(SlackAnswerDelivery.Modal);
    expect(calls).toEqual([
      {
        url: "https://slack.com/api/views.open",
        data: {
          trigger_id: "trigger-1",
          view: {
            type: "modal",
            title: { type: "plain_text", text: "OneUptime" },
            close: { type: "plain_text", text: "Close" },
            blocks: [
              ANSWER_SECTION,
              { type: "actions", elements: [CONNECT_BUTTON] },
            ],
          },
        },
        authorization: `Bearer ${PROJECT_TOKEN}`,
      },
    ]);
  });

  test("a product name too long for a modal's title is cut to Slack's 24 characters", async () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Observability Platform Cloud");

    await SlackActionAnswer.answer({
      place: {
        projectAuthToken: PROJECT_TOKEN,
        slackUserId: SLACK_USER,
        triggerId: "trigger-1",
      },
      answer: ANSWER,
    });

    const title: string = (
      ((calls[0]!.data["view"] as JSONObject)["title"] as JSONObject)[
        "text"
      ] as string
    ).toString();

    expect(title).toBe("Acme Observability Plat…");
    expect(title).toHaveLength(24);
  });

  test("only when no place in Slack takes it does the answer go to the direct messages", async () => {
    const directMessage: jest.SpyInstance = jest
      .spyOn(SlackUtil, "sendDirectMessageToUser")
      .mockResolvedValue(undefined);
    slackAnswers.set(RESPONSE_URL, () => {
      return new HTTPErrorResponse(404, { error: "no_such_url" }, {});
    });
    slackAnswers.set("https://slack.com/api/chat.postEphemeral", () => {
      return ok({ ok: false, error: "channel_not_found" });
    });

    const delivery: SlackAnswerDelivery = await SlackActionAnswer.answer({
      place: place(),
      answer: ANSWER,
    });

    expect(delivery).toBe(SlackAnswerDelivery.DirectMessage);
    expect(directMessage).toHaveBeenCalledTimes(1);
    expect(directMessage.mock.calls[0]![0]).toEqual({
      authToken: PROJECT_TOKEN,
      workspaceUserId: SLACK_USER,
      messageBlocks: [
        { _type: "WorkspacePayloadMarkdown", text: ANSWER.markdown },
      ],
    });
  });

  test("an answer nothing takes is logged, and the press is not failed for it", async () => {
    jest
      .spyOn(SlackUtil, "sendDirectMessageToUser")
      .mockRejectedValue(new Error("account_inactive"));
    const errorLog: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    await expect(
      SlackActionAnswer.answer({
        place: { projectAuthToken: PROJECT_TOKEN, slackUserId: SLACK_USER },
        answer: ANSWER,
      }),
    ).resolves.toBe(SlackAnswerDelivery.None);

    expect(errorLog).toHaveBeenCalledWith(
      "Could not answer a Slack press anywhere.",
    );
  });
});

describe("SlackActionAnswer.getPlace", () => {
  test("keeps the channel, the thread and Slack's own response_url", () => {
    expect(
      SlackActionAnswer.getPlace({
        projectAuthToken: PROJECT_TOKEN,
        slackUserId: SLACK_USER,
        slackChannelId: "C0INC2",
        slackThreadTs: "1760000000.000100",
        responseUrl: RESPONSE_URL,
        triggerId: "trigger-1",
        payloadType: "block_actions",
      }),
    ).toEqual({
      projectAuthToken: PROJECT_TOKEN,
      slackUserId: SLACK_USER,
      slackChannelId: "C0INC2",
      slackThreadTs: "1760000000.000100",
      responseUrl: RESPONSE_URL,
    });
  });

  test.each([
    ["another host", "https://evil.test/actions/T0TEAM/1/abc"],
    ["plain http", "http://hooks.slack.com/actions/T0TEAM/1/abc"],
    ["Slack's host only in the path", "https://evil.test/hooks.slack.com/x"],
    ["Slack's host only in a query", "https://evil.test/?u=hooks.slack.com"],
    ["a host that ends like Slack's", "https://hooks.slack.com.evil.test/x"],
    [
      "a user name that looks like Slack's",
      "https://hooks.slack.com@evil.test/x",
    ],
    ["no address at all", "not a url"],
  ])(
    "never keeps a response_url on %s",
    (_name: string, responseUrl: string) => {
      expect(
        SlackActionAnswer.getPlace({
          projectAuthToken: PROJECT_TOKEN,
          slackUserId: SLACK_USER,
          responseUrl: responseUrl,
        })?.responseUrl,
      ).toBeUndefined();
    },
  );

  test("only a shortcut is answered in a modal: everything else has a channel", () => {
    expect(
      SlackActionAnswer.getPlace({
        projectAuthToken: PROJECT_TOKEN,
        slackUserId: SLACK_USER,
        triggerId: "trigger-1",
        payloadType: "shortcut",
      })?.triggerId,
    ).toBe("trigger-1");

    expect(
      SlackActionAnswer.getPlace({
        projectAuthToken: PROJECT_TOKEN,
        slackUserId: SLACK_USER,
        triggerId: "trigger-1",
        payloadType: "view_submission",
      })?.triggerId,
    ).toBeUndefined();
  });

  test("without the project's token or the presser there is nowhere to answer", () => {
    expect(SlackActionAnswer.getPlace({ slackUserId: SLACK_USER })).toBeNull();
    expect(
      SlackActionAnswer.getPlace({ projectAuthToken: PROJECT_TOKEN }),
    ).toBeNull();
  });

  test("a response_url that is not Slack's is never posted to, even when handed straight to the sender", async () => {
    await expect(
      SlackUtil.sendEphemeralResponse({
        responseUrl: "https://evil.test/actions/T0TEAM/1/abc",
        messageBlocks: [],
      }),
    ).rejects.toThrow("Not a Slack response URL.");

    expect(calls).toEqual([]);
  });
});

describe("SlackActionAnswer.showModal", () => {
  test("a form carries the channel and thread it was opened from, so its submission is answered there", async () => {
    const showModal: jest.SpyInstance = jest
      .spyOn(SlackUtil, "showModalToUser")
      .mockResolvedValue(undefined);
    const modal: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Add Note",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: "SubmitIncidentNote",
      actionValue: "c0000000-0000-4000-8000-000000000001",
      blocks: [],
    };

    await SlackActionAnswer.showModal({
      source: {
        projectAuthToken: PROJECT_TOKEN,
        triggerId: "trigger-1",
        slackChannelId: "C0INC2",
        slackThreadTs: "1760000000.000100",
      },
      modalBlock: modal,
    });

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(showModal.mock.calls[0]![0]).toEqual({
      authToken: PROJECT_TOKEN,
      triggerId: "trigger-1",
      modalBlock: {
        ...modal,
        actionValue: JSON.stringify({
          oneuptime: 1,
          value: "c0000000-0000-4000-8000-000000000001",
          channelId: "C0INC2",
          threadTs: "1760000000.000100",
        }),
      },
    });
  });
});
