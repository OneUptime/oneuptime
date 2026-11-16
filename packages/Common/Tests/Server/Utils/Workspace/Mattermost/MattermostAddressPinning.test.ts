/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import MattermostUtil, {
  MattermostRequestError,
} from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import SafeWebhookRequest, {
  WEBHOOK_MAX_RESPONSE_BYTES,
} from "../../../../../Server/Utils/SafeWebhookRequest";
import HTTPMethod from "../../../../../Types/API/HTTPMethod";
import URL from "../../../../../Types/API/URL";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import Sleep from "../../../../../Types/Sleep";
import API from "../../../../../Utils/API";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import dns from "dns";
import http from "http";
import net, { AddressInfo } from "net";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A CALL TO A MATTERMOST SERVER GOES TO THE ADDRESS ITS URL CHECK APPROVED
 * (issue #6611).
 *
 * The server's address was typed by a member of the project, and every call
 * carries the bot's token, so a name that resolved publicly for the check
 * and somewhere internal a moment later would hand the token - and the call
 * - to the internal address. These call a server on this machine for real,
 * under names the check is told about and this machine's resolver is not:
 * only a call that dials what the check approved reaches it.
 */

const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";
const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ACCESS_TOKEN: string = "bot-token-6611";

interface SeenRequest {
  method: string;
  url: string;
  host: string;
  authorization: string;
}

let server: http.Server;
let port: number = 0;
let seen: Array<SeenRequest> = [];
let statuses: Array<number> = [];
let canUse127002: boolean = false;
let checkAnswers: Record<string, string> = {};
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  canUse127002 = await new Promise<boolean>(
    (resolve: (value: boolean) => void) => {
      const probe: http.Server = http.createServer();
      probe.once("error", () => {
        resolve(false);
      });
      probe.listen(0, "127.0.0.2", () => {
        probe.close(() => {
          resolve(true);
        });
      });
    },
  );

  server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      seen.push({
        method: request.method || "",
        url: request.url || "",
        host: request.headers["host"] || "",
        authorization: String(request.headers["authorization"] || ""),
      });

      const status: number = statuses.shift() || 200;

      request.resume();
      request.on("end", () => {
        if (status >= 300 && status < 400) {
          response.writeHead(status, {
            Location: `http://127.0.0.1:${port}/redirected`,
          });
          response.end();
          return;
        }

        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify(
            status === 200
              ? { id: "bot-id", username: "oneuptime" }
              : { id: "api.error", message: "Something is wrong." },
          ),
        );
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();

  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  seen = [];
  statuses = [];
  checkAnswers = {};

  for (const name of [ALLOWLIST_ENV, ALLOW_ENV, "HTTP_PROXY", "http_proxy"]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  // Loopback, named exactly: the one way a Mattermost server may be on this machine.
  process.env[ALLOWLIST_ENV] = "localhost,127.0.0.0/8";

  jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    hostname: string,
  ) => {
    const address: string | undefined = checkAnswers[hostname];

    if (!address) {
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    return [{ address: address, family: net.isIP(address) }];
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();

  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

async function callBot(serverUrl: string): Promise<JSONObject> {
  return await MattermostUtil.callServer<JSONObject>({
    serverUrl: serverUrl,
    accessToken: ACCESS_TOKEN,
    method: HTTPMethod.GET,
    path: "/api/v4/users/me",
    query: { page: "0", per_page: "200" },
    retry: true,
  });
}

describe("a call to the Mattermost server", () => {
  test("dials the address the check approved: a name only the check knows is reached, with the bot's token and the query", async () => {
    checkAnswers["mattermost.pinned.example"] = "127.0.0.1";

    const answer: JSONObject = await callBot(
      `http://mattermost.pinned.example:${port}`,
    );

    expect(answer).toEqual({ id: "bot-id", username: "oneuptime" });
    expect(seen).toEqual([
      {
        method: "GET",
        url: "/api/v4/users/me?page=0&per_page=200",
        host: `mattermost.pinned.example:${port}`,
        authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    ]);
  });

  test("a call that is tried again dials the approved address every time", async () => {
    checkAnswers["mattermost.pinned.example"] = "127.0.0.1";
    statuses = [503, 200];
    // The backoff between tries, skipped: the tries themselves are real.
    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);

    await callBot(`http://mattermost.pinned.example:${port}`);

    expect(seen).toHaveLength(2);
  });

  test("a server whose name resolves elsewhere after the check is not called there, and its token goes nowhere", async () => {
    if (!canUse127002) {
      return;
    }

    // This machine resolves localhost to 127.0.0.1, where the server is.
    checkAnswers["localhost"] = "127.0.0.2";

    await expect(
      MattermostUtil.callServer<JSONObject>({
        serverUrl: `http://localhost:${port}`,
        accessToken: ACCESS_TOKEN,
        method: HTTPMethod.GET,
        path: "/api/v4/users/me",
      }),
    ).rejects.toThrow(/ECONNREFUSED 127\.0\.0\.2/);

    expect(seen).toHaveLength(0);
  });

  test("follows no redirect: the call fails with the server's answer, and the redirect's target is never asked", async () => {
    statuses = [302];

    const error: unknown = await MattermostUtil.callServer<JSONObject>({
      serverUrl: `http://127.0.0.1:${port}`,
      accessToken: ACCESS_TOKEN,
      method: HTTPMethod.GET,
      path: "/api/v4/users/me",
    }).catch((caught: unknown) => {
      return caught;
    });

    expect(error).toBeInstanceOf(MattermostRequestError);
    expect((error as MattermostRequestError).statusCode).toBe(302);
    expect(
      seen.map((request: SeenRequest) => {
        return request.url;
      }),
    ).toEqual(["/api/v4/users/me"]);
  });

  test("a server on a private address is refused where the instance allows none, and dialled at its approved address where it does", async () => {
    process.env[ALLOWLIST_ENV] = "";
    checkAnswers["chat.corp.example"] = "10.1.2.3";

    await expect(callBot("https://chat.corp.example")).rejects.toThrow(
      BadDataException,
    );
    expect(seen).toHaveLength(0);

    process.env[ALLOW_ENV] = "true";
    const send: SpyInstance<typeof SafeWebhookRequest.send> = jest
      .spyOn(SafeWebhookRequest, "send")
      .mockRejectedValue(new Error("not sent in this test") as never);

    await expect(callBot("https://chat.corp.example")).rejects.toThrow(
      "not sent in this test",
    );

    expect(send.mock.calls[0]![0].addresses).toEqual([
      { address: "10.1.2.3", family: 4 },
    ]);
    expect(send.mock.calls[0]![0].url.href).toBe(
      "https://chat.corp.example/api/v4/users/me",
    );
  });

  test("an address on this machine or the cloud metadata service is refused on the most permissive setting", async () => {
    process.env[ALLOWLIST_ENV] = "";
    process.env[ALLOW_ENV] = "true";

    for (const serverUrl of [
      `http://127.0.0.1:${port}`,
      "http://169.254.169.254",
    ]) {
      await expect(callBot(serverUrl)).rejects.toThrow(BadDataException);
    }

    expect(seen).toHaveLength(0);
  });

  test("is held to the policy a member's server address always had", () => {
    expect(MattermostUtil.SERVER_TARGET_VALIDATION).toEqual({
      allowPrivateNetworkTargets: true,
      targetLabel: "Mattermost server address",
    });
  });
});

describe("a post to a Mattermost incoming webhook", () => {
  test("is held strictly: a private address is refused, whatever the instance allows", async () => {
    process.env[ALLOW_ENV] = "true";
    process.env[ALLOWLIST_ENV] = "chat.corp.example, 10.0.0.0/8";
    checkAnswers["chat.corp.example"] = "10.1.2.3";
    const post: SpyInstance<typeof API.post> = jest.spyOn(
      API,
      "post",
    ) as unknown as SpyInstance<typeof API.post>;

    await expect(
      MattermostUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString("https://chat.corp.example/hooks/abc123"),
        text: "The site is down",
      }),
    ).rejects.toThrow(BadDataException);

    expect(post).not.toHaveBeenCalled();
    expect(MattermostUtil.INCOMING_WEBHOOK_TARGET_VALIDATION).toEqual({
      targetLabel: "Mattermost webhook URL",
    });
  });

  test("dials the address its check approved, following no redirect", async () => {
    checkAnswers["chat.example.com"] = "93.184.216.34";
    const send: SpyInstance<typeof SafeWebhookRequest.send> = jest
      .spyOn(SafeWebhookRequest, "send")
      .mockRejectedValue(new Error("not sent in this test") as never);

    await expect(
      MattermostUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString("https://chat.example.com/hooks/abc123"),
        text: "The site is down",
      }),
    ).rejects.toThrow("not sent in this test");

    expect(send.mock.calls[0]![0].addresses).toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(send.mock.calls[0]![1]?.retries).toBe(3);
    expect(send.mock.calls[0]![1]?.maxContentLength).toBe(
      WEBHOOK_MAX_RESPONSE_BYTES,
    );
  });
});
