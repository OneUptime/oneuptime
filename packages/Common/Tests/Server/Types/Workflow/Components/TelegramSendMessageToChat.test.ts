import SendMessageToChat from "../../../../../Server/Types/Workflow/Components/Telegram/SendMessageToChat";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import API from "../../../../../Utils/API";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * "Send Message to Telegram" built its request URL with
 * URL.fromString(`https://api.telegram.org/bot${token}/sendMessage`). Once
 * Route began refusing scheme-like values, the bare path "bot<id>:<secret>/..."
 * was refused, so EVERY run failed before a request was sent - with the error
 * "Invalid route: bot<the whole token>/sendMessage", which put the credential
 * into the run log even though the argument itself is shown as [REDACTED].
 */

jest.mock("../../../../../Utils/API", () => {
  return {
    __esModule: true,
    default: { post: jest.fn() },
  };
});

const apiPostMock: jest.Mock = API.post as unknown as jest.Mock;

// Same shape as a real token: 10-digit bot id, 35-character secret.
const BOT_TOKEN: string = "8000000001:AAFakeFakeFakeFakeFakeFakeFake_-12345";

const HELP_MESSAGE: string =
  " Note: For usernames, the user must have started a conversation with the bot first. For groups/channels, the bot must be added as a member or admin.";

function makeOptions(): RunOptions {
  return {
    log: jest.fn() as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

function makeArgs(overrides: JSONObject = {}): JSONObject {
  return {
    "bot-token": BOT_TOKEN,
    "chat-id": "@mychannel",
    text: "Deploy finished",
    ...overrides,
  };
}

interface PostRequest {
  url: URL;
  data: JSONObject;
}

function getPostRequest(): PostRequest {
  return apiPostMock.mock.calls[0]![0] as PostRequest;
}

async function runAndGetError(args: JSONObject): Promise<Error> {
  try {
    await new SendMessageToChat().run(args, makeOptions());
  } catch (err) {
    return err as Error;
  }

  throw new Error("Expected the component to throw");
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Telegram SendMessageToChat - sending", () => {
  test("sends to the Bot API sendMessage URL instead of failing on Invalid route", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ok: true, result: {} }, {}),
    );

    const result: RunReturnType = await new SendMessageToChat().run(
      makeArgs(),
      makeOptions(),
    );

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(getPostRequest().url.toString()).toBe(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    );
    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues).toEqual({});
  });

  test("sends the chat id and text as the request body", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ok: true }, {}),
    );

    await new SendMessageToChat().run(
      makeArgs({ "chat-id": "-1001234567890", text: "Line 1\nLine 2" }),
      makeOptions(),
    );

    expect(getPostRequest().data).toEqual({
      chat_id: "-1001234567890",
      text: "Line 1\nLine 2",
    });
  });

  test("dials api.telegram.org over https with the token only in the path", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ok: true }, {}),
    );

    await new SendMessageToChat().run(makeArgs(), makeOptions());

    const url: URL = getPostRequest().url;
    expect(url.isHttps()).toBe(true);
    expect(url.hostname.hostname).toBe("api.telegram.org");
    expect(url.route.toString()).toBe(`/bot${BOT_TOKEN}/sendMessage`);
    expect(Object.keys(url.params)).toHaveLength(0);
  });

  test("trims whitespace a pasted or stored token picked up", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ok: true }, {}),
    );

    const result: RunReturnType = await new SendMessageToChat().run(
      makeArgs({ "bot-token": `  ${BOT_TOKEN}\n` }),
      makeOptions(),
    );

    expect(getPostRequest().url.toString()).toBe(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    );
    expect(result.executePort?.id).toBe("success");
  });

  test.each([
    ["a short secret", "1:A"],
    ["a hyphen and underscore", "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"],
    ["a long bot id", "1234567890123:AAE_underscored-and-dashed"],
  ])("accepts a token with %s", async (_label: string, token: string) => {
    apiPostMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ok: true }, {}),
    );

    const result: RunReturnType = await new SendMessageToChat().run(
      makeArgs({ "bot-token": token }),
      makeOptions(),
    );

    expect(getPostRequest().url.toString()).toBe(
      `https://api.telegram.org/bot${token}/sendMessage`,
    );
    expect(result.executePort?.id).toBe("success");
  });
});

describe("Telegram SendMessageToChat - Telegram errors go to the error port", () => {
  test("an HTTP error returns Telegram's description", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { ok: false, description: "Bad Request: chat not found" },
        {},
      ),
    );

    const result: RunReturnType = await new SendMessageToChat().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "Bad Request: chat not found" + HELP_MESSAGE,
    );
  });

  test("an HTTP error with no description falls back to a generic message", async () => {
    apiPostMock.mockResolvedValue(new HTTPErrorResponse(502, {}, {}));

    const result: RunReturnType = await new SendMessageToChat().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe("Server Error." + HELP_MESSAGE);
  });

  test("a 200 with ok:false is still an error", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { ok: false, description: "Forbidden: bot was blocked by the user" },
        {},
      ),
    );

    const result: RunReturnType = await new SendMessageToChat().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "Forbidden: bot was blocked by the user" + HELP_MESSAGE,
    );
  });

  test("a thrown HTTP error response returns its description", async () => {
    apiPostMock.mockRejectedValue(
      new HTTPErrorResponse(
        401,
        { ok: false, description: "Unauthorized" },
        {},
      ),
    );

    const result: RunReturnType = await new SendMessageToChat().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe("Unauthorized" + HELP_MESSAGE);
  });

  test("any other thrown error fails the step without quoting the token", async () => {
    apiPostMock.mockRejectedValue(
      new Error(
        `connect ECONNREFUSED https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      ),
    );

    const error: Error = await runAndGetError(makeArgs());

    expect(error.message).toBe("Something wrong happened.");
    expect(error.message).not.toContain(BOT_TOKEN);
  });
});

describe("Telegram SendMessageToChat - argument validation", () => {
  test.each([
    ["bot-token", "Telegram Bot Token not found"],
    ["chat-id", "Telegram Chat ID not found"],
    ["text", "Telegram message not found"],
  ])(
    "refuses a missing %s without sending",
    async (argument: string, expectedMessage: string) => {
      const args: JSONObject = makeArgs();
      delete args[argument];

      const error: Error = await runAndGetError(args);

      expect(error.message).toBe(expectedMessage);
      expect(apiPostMock).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["only whitespace", "   "],
    ["no colon", "8000000001AAFakeFakeFake"],
    ["a non-numeric bot id", "bot8000000001:AAFakeFakeFake"],
    ["an empty secret", "8000000001:"],
    ["an empty bot id", ":AAFakeFakeFake"],
    ["a space inside", "8000000001:AAFake Fake"],
    ["a path separator", "8000000001:AAFake/../../getUpdates"],
    ["a query", "8000000001:AAFake?offset=1"],
    ["a fragment", "8000000001:AAFake#x"],
    ["a second colon", "8000000001:AAFake:extra"],
    ["an '@'", "8000000001:AAFake@evil.example"],
    ["the '<BOT_TOKEN>' placeholder", "<BOT_TOKEN>"],
  ])(
    "refuses a token with %s, without sending and without quoting it",
    async (_label: string, token: string) => {
      const error: Error = await runAndGetError(
        makeArgs({ "bot-token": token }),
      );

      expect(error.message).toMatch(
        /^Telegram Bot Token is not in a valid format\./,
      );
      if (token.trim()) {
        expect(error.message).not.toContain(token.trim());
      }
      expect(apiPostMock).not.toHaveBeenCalled();
    },
  );

  test("a malformed token never reaches the error message, even partially", async () => {
    const secret: string = "AAFakeFakeFakeFakeFakeFakeFake_-12345";

    const error: Error = await runAndGetError(
      makeArgs({ "bot-token": `8000000001:${secret} trailing` }),
    );

    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain("8000000001");
  });
});

describe("Telegram SendMessageToChat.isValidBotToken", () => {
  test.each([
    [BOT_TOKEN, true],
    ["123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11", true],
    ["1:a", true],
    ["", false],
    ["123456", false],
    ["abc:def", false],
    ["123456:", false],
    [" 123456:abc", false],
    ["123456:abc ", false],
    ["123456:abc/def", false],
    ["123456:abc%2Fdef", false],
  ])("isValidBotToken(%j) is %s", (token: string, expected: boolean) => {
    expect(SendMessageToChat.isValidBotToken(token)).toBe(expected);
  });
});
