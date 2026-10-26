import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import API from "../../../../../Utils/API";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import SlackActionAnswer, {
  SlackAnswerDelivery,
  SlackAnswerPlace,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/Answer";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";

/*
 * WHAT A CHOICE OF PROJECT REPLACES.
 *
 * Once somebody chooses the project of a request (SlackProjectChoice), the
 * question they chose in is replaced: a message, through its press's
 * response_url (replace_original); a modal - a shortcut's - by what the
 * request opens or answers, through views.update, since views.open cannot
 * open a modal over another. These pin what Slack is sent for each.
 */

jest.mock("../../../../../Server/Utils/Logger");

const RESPONSE_URL: string =
  "https://hooks.slack.com/actions/T0AVEPOINT/1760000002/choiceGhi789";
const VIEW_ID: string = "V0CHOICE";
const TRIGGER_ID: string = "1760000002.choice-trigger";
const PROJECT_ID: ObjectID = new ObjectID(
  "f2000000-0000-4000-8000-000000000001",
);

interface Sent {
  url: string;
  data: JSONObject;
  headers: JSONObject;
}

// Slack's Markdown sets bold apart with zero-width spaces.
function withoutZeroWidthSpaces(value: unknown): string {
  return JSON.stringify(value).split(String.fromCharCode(0x200b)).join("");
}

let sent: Array<Sent>;
let slackAnswers: Array<JSONObject | HTTPErrorResponse>;

const MARKDOWN: WorkspacePayloadMarkdown = {
  _type: "WorkspacePayloadMarkdown",
  text: "Going ahead in **IRM Non-Prod**.",
};

const FORM: WorkspaceModalBlock = {
  _type: "WorkspaceModalBlock",
  title: "New Incident",
  submitButtonTitle: "Submit",
  cancelButtonTitle: "Cancel",
  actionId: "SubmitNewIncident",
  actionValue: "",
  blocks: [MARKDOWN],
};

beforeEach(() => {
  sent = [];
  slackAnswers = [];

  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data: JSONObject;
    headers: JSONObject;
  }) => {
    sent.push({
      url: options.url.toString(),
      data: options.data,
      headers: options.headers,
    });

    const answer: JSONObject | HTTPErrorResponse = slackAnswers.shift() || {
      ok: true,
    };

    if (answer instanceof HTTPErrorResponse) {
      return answer;
    }

    return new HTTPResponse<JSONObject>(200, answer, {});
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SlackUtil.replaceMessageAtResponseUrl", () => {
  test("puts the blocks in place of the message the button was on, with its notification text", async () => {
    await SlackUtil.replaceMessageAtResponseUrl({
      responseUrl: RESPONSE_URL,
      messageBlocks: [MARKDOWN],
      text: "Going ahead in IRM Non-Prod.",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(RESPONSE_URL);
    expect(sent[0]!.data["replace_original"]).toBe(true);
    expect(sent[0]!.data["response_type"]).toBeUndefined();
    expect(sent[0]!.data["text"]).toBe("Going ahead in IRM Non-Prod.");
    expect(withoutZeroWidthSpaces(sent[0]!.data["blocks"])).toContain(
      "Going ahead in *IRM Non-Prod*.",
    );
    // A response_url takes no token.
    expect(sent[0]!.headers["Authorization"]).toBeUndefined();
  });

  test("never posts anywhere but Slack's own response URLs", async () => {
    for (const responseUrl of [
      "https://evil.test/hooks.slack.com/actions/1",
      "http://hooks.slack.com/actions/T0/1/x",
      "https://hooks.slack.com.evil.test/actions/1",
      "https://evil.test#https://hooks.slack.com/actions/1",
    ]) {
      await expect(
        SlackUtil.replaceMessageAtResponseUrl({
          responseUrl: responseUrl,
          messageBlocks: [MARKDOWN],
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    }

    expect(sent).toEqual([]);
  });

  test("throws when Slack refuses it: an expired or used address", async () => {
    slackAnswers.push({ ok: false, error: "expired_url" });

    await expect(
      SlackUtil.replaceMessageAtResponseUrl({
        responseUrl: RESPONSE_URL,
        messageBlocks: [MARKDOWN],
      }),
    ).rejects.toThrow("expired_url");

    slackAnswers.push(new HTTPErrorResponse(404, { error: "not found" }, {}));

    await expect(
      SlackUtil.replaceMessageAtResponseUrl({
        responseUrl: RESPONSE_URL,
        messageBlocks: [MARKDOWN],
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

describe("SlackUtil.replaceModal", () => {
  test("views.update: the form in place of the open modal, as views.open would have shown it", async () => {
    await SlackUtil.replaceModal({
      authToken: "xoxb-nonprod",
      viewId: VIEW_ID,
      modalBlock: FORM,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://slack.com/api/views.update");
    expect(sent[0]!.headers["Authorization"]).toBe("Bearer xoxb-nonprod");
    expect(sent[0]!.data["view_id"]).toBe(VIEW_ID);
    expect(sent[0]!.data["trigger_id"]).toBeUndefined();

    const view: JSONObject = sent[0]!.data["view"] as JSONObject;

    expect(view).toEqual(SlackUtil.getModalBlock({ payloadModalBlock: FORM }));
    expect(view["callback_id"]).toBe("SubmitNewIncident");
  });

  test("throws when Slack refuses it: a modal closed since", async () => {
    slackAnswers.push({ ok: false, error: "not_found" });

    await expect(
      SlackUtil.replaceModal({
        authToken: "xoxb-nonprod",
        viewId: VIEW_ID,
        modalBlock: FORM,
      }),
    ).rejects.toThrow("not_found");
  });
});

describe("SlackUtil.showMessageInModal", () => {
  test("with a view id: the message in place of that modal", async () => {
    await SlackUtil.showMessageInModal({
      authToken: "xoxb-nonprod",
      triggerId: TRIGGER_ID,
      title: "OneUptime",
      messageBlocks: [MARKDOWN],
      viewId: VIEW_ID,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://slack.com/api/views.update");
    expect(sent[0]!.data["view_id"]).toBe(VIEW_ID);
    expect((sent[0]!.data["view"] as JSONObject)["type"]).toBe("modal");
    expect(withoutZeroWidthSpaces(sent[0]!.data["view"])).toContain(
      "Going ahead in *IRM Non-Prod*.",
    );
  });

  test("without one: a new modal, on the press's trigger", async () => {
    await SlackUtil.showMessageInModal({
      authToken: "xoxb-nonprod",
      triggerId: TRIGGER_ID,
      title: "OneUptime",
      messageBlocks: [MARKDOWN],
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://slack.com/api/views.open");
    expect(sent[0]!.data["trigger_id"]).toBe(TRIGGER_ID);
  });
});

describe("SlackActionAnswer: a press made again once its project was chosen in a modal", () => {
  test("the place takes the modal only with a shortcut's or a Home's trigger", () => {
    expect(
      SlackActionAnswer.getPlace({
        projectAuthToken: "xoxb-nonprod",
        slackUserId: "U0DEANE",
        triggerId: TRIGGER_ID,
        payloadType: "shortcut",
        replaceViewId: VIEW_ID,
      }),
    ).toEqual({
      projectAuthToken: "xoxb-nonprod",
      slackUserId: "U0DEANE",
      triggerId: TRIGGER_ID,
      viewId: VIEW_ID,
    });

    expect(
      SlackActionAnswer.getPlace({
        projectAuthToken: "xoxb-nonprod",
        slackUserId: "U0DEANE",
        triggerId: TRIGGER_ID,
        payloadType: "block_actions",
        slackViewType: "home",
        replaceViewId: VIEW_ID,
      })?.viewId,
    ).toBe(VIEW_ID);

    // A command answers in its channel: there is no modal to replace.
    expect(
      SlackActionAnswer.getPlace({
        projectAuthToken: "xoxb-nonprod",
        slackUserId: "U0DEANE",
        slackChannelId: "C0GENERAL",
        responseUrl: RESPONSE_URL,
        triggerId: TRIGGER_ID,
        replaceViewId: VIEW_ID,
      })?.viewId,
    ).toBeUndefined();
  });

  test("an answer with no channel takes the modal's place", async () => {
    const place: SlackAnswerPlace = {
      projectAuthToken: "xoxb-nonprod",
      slackUserId: "U0DEANE",
      triggerId: TRIGGER_ID,
      viewId: VIEW_ID,
    };

    expect(
      await SlackActionAnswer.answer({
        place: place,
        answer: { markdown: "On call in **IRM Non-Prod**", text: "On call" },
      }),
    ).toBe(SlackAnswerDelivery.Modal);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://slack.com/api/views.update");
    expect(sent[0]!.data["view_id"]).toBe(VIEW_ID);
  });

  test("a form it opens takes the modal's place, carrying the project and where it was opened", async () => {
    await SlackActionAnswer.showModal({
      source: {
        projectAuthToken: "xoxb-nonprod",
        slackUserId: "U0DEANE",
        triggerId: TRIGGER_ID,
        payloadType: "shortcut",
        projectId: PROJECT_ID,
        replaceViewId: VIEW_ID,
      },
      modalBlock: FORM,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://slack.com/api/views.update");
    expect(sent[0]!.data["view_id"]).toBe(VIEW_ID);
    expect(
      JSON.parse(
        (sent[0]!.data["view"] as JSONObject)["private_metadata"] as string,
      ),
    ).toEqual({ oneuptime: 1, value: "", projectId: PROJECT_ID.toString() });
  });

  test("with no modal to replace, a form opens on the press's trigger, as always", async () => {
    await SlackActionAnswer.showModal({
      source: {
        projectAuthToken: "xoxb-nonprod",
        slackUserId: "U0DEANE",
        slackChannelId: "C0GENERAL",
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
      },
      modalBlock: FORM,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://slack.com/api/views.open");
    expect(sent[0]!.data["trigger_id"]).toBe(TRIGGER_ID);
    expect(
      JSON.parse(
        (sent[0]!.data["view"] as JSONObject)["private_metadata"] as string,
      ),
    ).toEqual({
      oneuptime: 1,
      value: "",
      channelId: "C0GENERAL",
      projectId: PROJECT_ID.toString(),
    });
  });
});
