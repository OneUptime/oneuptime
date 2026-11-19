import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import API from "../../../../../Utils/API";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A MESSAGE THE BOT POSTED, DELETED (chat.delete), so what OneUptime AI read
 * in a call's transcript is taken back from the incident's Slack channels
 * with the transcript (#9290). One Slack no longer has was deleted already;
 * any other refusal is thrown, in Slack's words, for the removal to say
 * where the message stays.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

let calls: Array<{ method: string; body: JSONObject; token: string }>;
let answer: () => JSONObject | HTTPErrorResponse;

beforeEach(() => {
  calls = [];
  answer = (): JSONObject => {
    return { ok: true, channel: "C0INC42", ts: "1760713500.000100" };
  };

  jest.spyOn(API, "post").mockImplementation((async (data: {
    url: { toString: () => string };
    data: JSONObject;
    headers: Record<string, string>;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    calls.push({
      method: data.url.toString().split("/api/")[1] || "",
      body: data.data,
      token: data.headers["Authorization"] || "",
    });

    const answered: JSONObject | HTTPErrorResponse = answer();

    if (answered instanceof HTTPErrorResponse) {
      return answered;
    }

    return {
      jsonData: answered,
      data: answered,
    } as unknown as HTTPResponse<JSONObject>;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function deleteIt(): Promise<void> {
  await SlackUtil.deleteMessage({
    authToken: "xoxb-project-token",
    projectId: PROJECT_ID,
    location: { channelId: "C0INC42" },
    messageId: "1760713500.000100",
  });
}

describe("SlackUtil.deleteMessage", () => {
  test("asks Slack to delete the message by its channel and ts, as the project's bot", async () => {
    await deleteIt();

    expect(calls).toEqual([
      {
        method: "chat.delete",
        body: { channel: "C0INC42", ts: "1760713500.000100" },
        token: "Bearer xoxb-project-token",
      },
    ]);
  });

  test("a message Slack no longer has was deleted already: nothing to say", async () => {
    answer = (): JSONObject => {
      return { ok: false, error: "message_not_found" };
    };

    await expect(deleteIt()).resolves.toBeUndefined();
  });

  test.each(["channel_not_found", "is_archived", "cant_delete_message"])(
    "a refusal - %s - is thrown, for the removal to say where the message stays",
    async (code: string) => {
      answer = (): JSONObject => {
        return { ok: false, error: code };
      };

      const thrown: unknown = await deleteIt().catch((error: unknown) => {
        return error;
      });

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as { slackCode?: string }).slackCode).toBe(code);
    },
  );

  test("Slack answering with an HTTP error is thrown as Slack's refusal", async () => {
    answer = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        429,
        { ok: false, error: "ratelimited" },
        {},
      );
    };

    const thrown: unknown = await deleteIt().catch((error: unknown) => {
      return error;
    });

    expect((thrown as { slackCode?: string }).slackCode).toBe("ratelimited");
  });
});
