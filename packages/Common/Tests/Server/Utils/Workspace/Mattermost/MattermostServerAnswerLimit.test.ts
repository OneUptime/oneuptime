/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import MattermostUtil, {
  MattermostChannel,
} from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import SafeWebhookRequest from "../../../../../Server/Utils/SafeWebhookRequest";
import HTTPMethod from "../../../../../Types/API/HTTPMethod";
import APIException from "../../../../../Types/Exception/ApiException";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
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
import http from "http";
import { AddressInfo } from "net";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A CALL TO A MATTERMOST SERVER READS AT MOST SO MUCH OF ITS ANSWER (issue
 * #8875).
 *
 * The server's address is a project member's to type, and every call to it
 * used to read an answer of any size, so a server that streamed forever
 * filled the worker's memory. A call now reads at most
 * SERVER_MAX_RESPONSE_BYTES: a listing's limit, because one of Mattermost's
 * answers is never paged - the channels the bot is in, on a team, which a
 * bot that opens a channel per incident can be in thousands of. A larger
 * answer fails, saying so, and is not asked for again.
 *
 * These call a server on this machine for real, which answers with a body
 * of exactly the size a test asks for.
 */

const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";
const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const PROXY_ENVS: Array<string> = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
];
const ACCESS_TOKEN: string = "bot-token-8875";
const TEAM_ID: string = "jzaw5d8ad3fbbg1qaz1bqgxbbw";
const BOT_USER_ID: string = "o1b2t3u4s5e6r7i8d9a0b1c2d3";
const MEBIBYTE: number = 1024 * 1024;

let server: http.Server;
let port: number = 0;
let seen: Array<string> = [];
let answer: (path: string) => string = (): string => {
  return JSON.stringify({ id: "bot-id" });
};
const savedEnv: Record<string, string | undefined> = {};

// A JSON object of exactly `bytes` bytes.
function jsonOfSize(bytes: number): string {
  const padding: number = bytes - Buffer.byteLength('{"padding":""}');
  const body: string = JSON.stringify({ padding: "x".repeat(padding) });

  expect(Buffer.byteLength(body)).toBe(bytes);

  return body;
}

// A channel as Mattermost lists it: about 700 bytes, with a purpose.
function channel(index: number): JSONObject {
  const id: string = `c${String(index).padStart(25, "0")}`;

  return {
    id: id,
    create_at: 1700000000000,
    update_at: 1700000000000,
    delete_at: 0,
    team_id: TEAM_ID,
    type: "P",
    display_name: `Incident ${index}: payment API answers slowly`,
    name: `incident-${index}-payment-api-answers-slowly`,
    header: "",
    purpose: `Opened by OneUptime for incident ${index}. Follow the timeline in OneUptime.`,
    last_post_at: 1700000000000,
    total_msg_count: 12,
    extra_update_at: 0,
    creator_id: BOT_USER_ID,
    scheme_id: null,
    props: null,
    group_constrained: null,
    shared: false,
    total_msg_count_root: 3,
    policy_id: null,
    last_root_post_at: 1700000000000,
  } as unknown as JSONObject;
}

async function callServer(): Promise<JSONObject> {
  return await MattermostUtil.callServer<JSONObject>({
    serverUrl: `http://127.0.0.1:${port}`,
    accessToken: ACCESS_TOKEN,
    method: HTTPMethod.GET,
    path: "/api/v4/users/me",
    retry: true,
  });
}

beforeAll(async () => {
  server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      const path: string = (request.url || "").split("?")[0] || "";
      seen.push(path);

      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(answer(path));
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
  answer = (): string => {
    return JSON.stringify({ id: "bot-id" });
  };

  for (const name of [ALLOWLIST_ENV, ALLOW_ENV, ...PROXY_ENVS]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  // Loopback, named exactly: the one way a Mattermost server may be on this machine.
  process.env[ALLOWLIST_ENV] = "127.0.0.0/8";
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

describe("a call to a Mattermost server", () => {
  test("reads a listing's worth of an answer: 8 MB", () => {
    expect(MattermostUtil.SERVER_MAX_RESPONSE_BYTES).toBe(8 * MEBIBYTE);
  });

  test("an answer larger than that is not read, and the call fails saying so", async () => {
    answer = (): string => {
      return jsonOfSize(MattermostUtil.SERVER_MAX_RESPONSE_BYTES + 1);
    };

    const error: unknown = await callServer().catch((caught: unknown) => {
      return caught;
    });

    expect(error).toBeInstanceOf(APIException);
    expect((error as Error).message).toBe(
      "Mattermost's answer was larger than 8\u00A0MB, so it was not read.",
    );
    // Nothing of the server's address, nor of the bot's token.
    expect((error as Error).message).not.toMatch(
      new RegExp(`127\\.0\\.0\\.1|${port}|${ACCESS_TOKEN}`),
    );
  });

  test("is not asked for again, though a call that changes nothing may be retried", async () => {
    answer = (): string => {
      return jsonOfSize(MattermostUtil.SERVER_MAX_RESPONSE_BYTES + 1);
    };

    await expect(callServer()).rejects.toThrow(APIException);

    // Asking again would only read as much of the same answer again.
    expect(seen).toEqual(["/api/v4/users/me"]);
  });

  test("an answer of exactly 8 MB is read", async () => {
    answer = (): string => {
      return jsonOfSize(MattermostUtil.SERVER_MAX_RESPONSE_BYTES);
    };

    const user: JSONObject = await callServer();

    expect(String(user["padding"]).length).toBeGreaterThan(
      MattermostUtil.SERVER_MAX_RESPONSE_BYTES - 64,
    );
  });

  test("names its limit to every request it sends", async () => {
    const send: SpyInstance<typeof SafeWebhookRequest.send> = jest.spyOn(
      SafeWebhookRequest,
      "send",
    ) as unknown as SpyInstance<typeof SafeWebhookRequest.send>;

    await callServer();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]?.maxContentLength).toBe(
      MattermostUtil.SERVER_MAX_RESPONSE_BYTES,
    );
  });
});

describe("the channels a busy bot is in, which Mattermost does not page", () => {
  test("a bot in 5,000 channels still lists them: the one answer is well past 1 MB, and inside the limit", async () => {
    const memberChannels: JSONArray = Array.from(
      { length: 5000 },
      (_value: unknown, index: number): JSONObject => {
        return channel(index);
      },
    );
    const memberChannelsBody: string = JSON.stringify(memberChannels);

    expect(Buffer.byteLength(memberChannelsBody)).toBeGreaterThan(2 * MEBIBYTE);
    expect(Buffer.byteLength(memberChannelsBody)).toBeLessThan(
      MattermostUtil.SERVER_MAX_RESPONSE_BYTES,
    );

    answer = (path: string): string => {
      // The team's public channels: none, on one page.
      if (path === `/api/v4/teams/${TEAM_ID}/channels`) {
        return JSON.stringify([]);
      }

      return memberChannelsBody;
    };

    const channels: Array<MattermostChannel> =
      await MattermostUtil.listChannels({
        serverUrl: `http://127.0.0.1:${port}`,
        accessToken: ACCESS_TOKEN,
        teamId: TEAM_ID,
        botUserId: BOT_USER_ID,
      });

    expect(channels).toHaveLength(5000);
    expect(seen).toEqual([
      `/api/v4/teams/${TEAM_ID}/channels`,
      `/api/v4/users/${BOT_USER_ID}/teams/${TEAM_ID}/channels`,
    ]);
  });
});
