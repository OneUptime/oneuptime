import DiscordSendMessage from "../../../../../Server/Types/Workflow/Components/Discord/SendMessageToChannel";
import MicrosoftTeamsSendMessage from "../../../../../Server/Types/Workflow/Components/MicrosoftTeams/SendMessageToChannel";
import SlackSendMessage from "../../../../../Server/Types/Workflow/Components/Slack/SendMessageToChannel";
import ComponentCode, {
  RunOptions,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import API from "../../../../../Utils/API";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Slack / Discord / Microsoft Teams workflow components take a free-text
 * "webhook-url" argument and POST to it from the API server, with no check —
 * the same SSRF GHSA-v5xh-rw9h-77fv reported against the API components, one
 * component over. Because these are chat webhooks there is a real vendor host
 * to pin to, which is stronger than a blocklist: a pin cannot be walked around
 * with DNS rebinding, an alternate IP notation, or a redirect.
 *
 * Slack's and Teams' pins already existed but were only ever called from the
 * status page subscriber path; Discord had none at all.
 */

jest.mock("../../../../../Utils/API", () => {
  return {
    __esModule: true,
    default: { post: jest.fn() },
  };
});

/*
 * Slack posts through SlackUtil rather than calling API.post itself. That
 * module pulls in the workspace stack, so stub it down to the one method the
 * component uses — the pin under test lives in the component and in the
 * (separately tested) util, not in the transport.
 */
jest.mock("../../../../../Server/Utils/Workspace/Slack/Slack", () => {
  const actual: { default: { isValidSlackIncomingWebhookUrl: unknown } } =
    jest.requireActual("../../../../../Server/Utils/Workspace/Slack/Slack");
  return {
    __esModule: true,
    default: {
      isValidSlackIncomingWebhookUrl:
        actual.default.isValidSlackIncomingWebhookUrl,
      sendMessageToChannelViaIncomingWebhook: jest.fn(),
    },
  };
});

import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";

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

const apiPostMock: jest.Mock = API.post as unknown as jest.Mock;
const slackSendMock: jest.Mock =
  SlackUtil.sendMessageToChannelViaIncomingWebhook as unknown as jest.Mock;

/*
 * Every one of these is a place the request must not go. They cover the shapes
 * the guard has to survive: raw internal literals, a URL whose PATH or QUERY
 * mentions the vendor domain, a host that merely ends in something similar, and
 * the "#"/"?" parser trick that made "https://169.254.169.254#.office.com" look
 * like a Microsoft host to OneUptime's own URL parser while axios dialled the
 * metadata endpoint.
 */
function unsafeUrlsFor(vendorDomain: string): Array<[string, string]> {
  return [
    ["the cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
    ["loopback", "http://127.0.0.1:8080/"],
    ["localhost", "http://localhost/hook"],
    ["an RFC-1918 address", "http://10.0.0.5/hook"],
    [
      "an internal host with the vendor domain in the query",
      `http://169.254.169.254/?x=${vendorDomain}`,
    ],
    [
      "an internal host with the vendor domain in a fragment",
      `https://169.254.169.254#.${vendorDomain}`,
    ],
    [
      "an internal host with the vendor domain in the path",
      `http://10.0.0.5/${vendorDomain}/webhook`,
    ],
    ["a lookalike suffix domain", `https://evil-${vendorDomain}/webhook`],
    ["a subdomain-of-attacker domain", `https://${vendorDomain}.evil.tld/hook`],
    ["plain http on the real vendor host", `http://${vendorDomain}/webhook`],
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Discord SendMessageToChannel — webhook URL pin", () => {
  test.each(unsafeUrlsFor("discord.com"))(
    "refuses %s and never sends",
    async (_label: string, url: string) => {
      await expect(
        new DiscordSendMessage().run(
          { text: "hi", "webhook-url": url },
          makeOptions(),
        ),
      ).rejects.toThrow();
      expect(apiPostMock).not.toHaveBeenCalled();
    },
  );

  test("sends to a genuine Discord webhook, with redirects off", async () => {
    apiPostMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));

    await new DiscordSendMessage().run(
      {
        text: "hi",
        "webhook-url": "https://discord.com/api/webhooks/123/abcdef",
      },
      makeOptions(),
    );

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    const request: { options?: { doNotFollowRedirects?: boolean } } =
      apiPostMock.mock.calls[0]![0] as {
        options?: { doNotFollowRedirects?: boolean };
      };
    expect(request.options?.doNotFollowRedirects).toBe(true);
  });

  test("accepts the discordapp.com alias", async () => {
    apiPostMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));

    await new DiscordSendMessage().run(
      {
        text: "hi",
        "webhook-url": "https://discordapp.com/api/webhooks/123/abcdef",
      },
      makeOptions(),
    );

    expect(apiPostMock).toHaveBeenCalledTimes(1);
  });
});

describe("Microsoft Teams SendMessageToChannel — webhook URL pin", () => {
  test.each(unsafeUrlsFor("office.com"))(
    "refuses %s and never sends",
    async (_label: string, url: string) => {
      await expect(
        new MicrosoftTeamsSendMessage().run(
          { text: "hi", "webhook-url": url },
          makeOptions(),
        ),
      ).rejects.toThrow();
      expect(apiPostMock).not.toHaveBeenCalled();
    },
  );

  test("sends to a genuine Teams webhook, with redirects off", async () => {
    apiPostMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));

    await new MicrosoftTeamsSendMessage().run(
      {
        text: "hi",
        "webhook-url": "https://outlook.office.com/webhook/abc/IncomingWebhook",
      },
      makeOptions(),
    );

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    const request: { options?: { doNotFollowRedirects?: boolean } } =
      apiPostMock.mock.calls[0]![0] as {
        options?: { doNotFollowRedirects?: boolean };
      };
    expect(request.options?.doNotFollowRedirects).toBe(true);
  });
});

describe("Slack SendMessageToChannel — webhook URL pin", () => {
  test.each(unsafeUrlsFor("slack.com"))(
    "refuses %s and never sends",
    async (_label: string, url: string) => {
      await expect(
        new SlackSendMessage().run(
          { text: "hi", "webhook-url": url },
          makeOptions(),
        ),
      ).rejects.toThrow();
      expect(slackSendMock).not.toHaveBeenCalled();
    },
  );

  test("refuses a Slack host without the /services/ path prefix", async () => {
    await expect(
      new SlackSendMessage().run(
        { text: "hi", "webhook-url": "https://hooks.slack.com/evil" },
        makeOptions(),
      ),
    ).rejects.toThrow();
    expect(slackSendMock).not.toHaveBeenCalled();
  });

  test("sends to a genuine Slack incoming webhook", async () => {
    slackSendMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));

    await new SlackSendMessage().run(
      {
        text: "hi",
        "webhook-url": "https://hooks.slack.com/services/T000/B000/XXXX",
      },
      makeOptions(),
    );

    expect(slackSendMock).toHaveBeenCalledTimes(1);
  });
});

describe("every chat component rejects a missing URL", () => {
  const components: Array<[string, () => ComponentCode]> = [
    [
      "Discord",
      (): ComponentCode => {
        return new DiscordSendMessage();
      },
    ],
    [
      "MicrosoftTeams",
      (): ComponentCode => {
        return new MicrosoftTeamsSendMessage();
      },
    ],
    [
      "Slack",
      (): ComponentCode => {
        return new SlackSendMessage();
      },
    ],
  ];

  test.each(components)(
    "%s",
    async (_label: string, make: () => ComponentCode) => {
      await expect(make().run({ text: "hi" }, makeOptions())).rejects.toThrow();
    },
  );
});
