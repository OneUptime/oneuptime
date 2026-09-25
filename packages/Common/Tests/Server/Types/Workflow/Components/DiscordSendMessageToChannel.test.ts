import SendMessageToChannel from "../../../../../Server/Types/Workflow/Components/Discord/SendMessageToChannel";
import DiscordWebhook from "../../../../../Server/Utils/Workspace/Discord/DiscordWebhook";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import Exception from "../../../../../Types/Exception/Exception";
import ObjectID from "../../../../../Types/ObjectID";
import API, { APIRequestOptions } from "../../../../../Utils/API";

jest.mock("../../../../../Utils/API", () => {
  return { __esModule: true, default: { post: jest.fn() } };
});

const webhook: string =
  "https://discord.com/api/webhooks/123456789012345678/test-token";

function options(): RunOptions {
  return {
    log: jest.fn() as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: (exception: Exception): Exception => {
      return exception;
    },
    executeWorkflow: async (): Promise<void> => {},
  };
}

describe("Discord webhook workflow", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test.each([
    "http://discord.com/api/webhooks/123456789012345678/token",
    "https://discord.com.evil.example/api/webhooks/123456789012345678/token",
    "https://discord.com@localhost/api/webhooks/123456789012345678/token",
    "https://discord.com/api/webhooks/123456789012345678/token/../../users/@me",
    "https://discord.com/api/webhooks/123456789012345678/token?redirect=localhost",
    "https://localhost/api/webhooks/123456789012345678/token",
  ])("rejects unsafe webhook %s", async (url: string) => {
    expect(DiscordWebhook.isValidUrl(url)).toBe(false);
    await expect(
      new SendMessageToChannel().run(
        { "webhook-url": url, text: "hello" },
        options(),
      ),
    ).rejects.toThrow("Webhook URL");
    expect(API.post).not.toHaveBeenCalled();
  });

  test("sends bounded messages without mentions, waits for persistence, and selects success", async () => {
    (API.post as jest.Mock).mockResolvedValue(
      new HTTPResponse(200, { id: "123456789012345678" }, {}),
    );
    const text: string = "@everyone " + "a".repeat(3000);
    const result: RunReturnType = await new SendMessageToChannel().run(
      { "webhook-url": webhook, text },
      options(),
    );
    expect(result.executePort?.id).toBe("success");
    expect(API.post).toHaveBeenCalledTimes(2);
    const requests: Array<APIRequestOptions> = (
      API.post as jest.Mock
    ).mock.calls.map((call: Array<APIRequestOptions>): APIRequestOptions => {
      return call[0]!;
    });
    expect(
      requests
        .map((request: APIRequestOptions): unknown => {
          return (request.data as { content: string }).content;
        })
        .join(""),
    ).toBe(text);
    for (const request of requests) {
      expect(request.params).toEqual({ wait: "true" });
      expect(request.options).toMatchObject({
        retries: 0,
        doNotFollowRedirects: true,
      });
      expect(request.data).toHaveProperty("allowed_mentions", {
        parse: [],
        replied_user: false,
      });
    }
  });

  test("stops on provider error and selects the error port without leaking provider data", async () => {
    (API.post as jest.Mock).mockResolvedValue(
      new HTTPErrorResponse(403, { message: "private-provider-data" }, {}),
    );
    const result: RunReturnType = await new SendMessageToChannel().run(
      { "webhook-url": webhook, text: "hello" },
      options(),
    );
    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues).toEqual({
      error: "Discord webhook failed (HTTP 403).",
    });
    expect(API.post).toHaveBeenCalledTimes(1);
  });
});

test("preserves a legacy Discord webhook thread destination and forces persistence", async () => {
  jest.resetAllMocks();
  const url: string =
    "https://discordapp.com/api/webhooks/123456789012345678/test-token?thread_id=333333333333333333&wait=false";
  expect(DiscordWebhook.isValidUrl(url)).toBe(true);
  (API.post as jest.Mock).mockResolvedValue(
    new HTTPResponse(200, { id: "444444444444444444" }, {}),
  );
  await new SendMessageToChannel().run(
    { "webhook-url": url, text: "thread message" },
    options(),
  );
  const request: APIRequestOptions = (API.post as jest.Mock).mock.calls[0]![0];
  expect(request.params).toMatchObject({
    wait: "true",
    thread_id: "333333333333333333",
  });
});
