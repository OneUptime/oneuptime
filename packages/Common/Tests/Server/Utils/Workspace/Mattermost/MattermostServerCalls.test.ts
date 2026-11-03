import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import MattermostUtil, {
  MATTERMOST_DIALOG_PATH,
  MattermostRequestError,
  MattermostUser,
} from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostConnection from "../../../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import SSRFProtection from "../../../../../Server/Utils/SSRFProtection";
import {
  WorkspaceSendMessageResponse,
  WorkspaceChannel,
} from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import API from "../../../../../Utils/API";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import URL from "../../../../../Types/API/URL";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { WorkspaceMessageBlock } from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";

/*
 * Every call OneUptime makes to a Mattermost server, as the bot: the path,
 * the method, the body and the headers, against a server answered here.
 * The server's address was typed by a project member, so every call is
 * also held to what OneUptime may reach, and follows no redirect.
 */

const SERVER: string = "https://chat.example.com";
const TEAM_ID: string = "t".repeat(26);
const BOT_ID: string = "b".repeat(26);
const ALICE_ID: string = "a".repeat(26);
const BOB_ID: string = "z".repeat(26);
const PUBLIC_CHANNEL_ID: string = "c".repeat(26);
const PRIVATE_CHANNEL_ID: string = "p".repeat(26);
const POST_ID: string = "m".repeat(26);
const ACCESS_TOKEN: string = "abcdefghijklmnopqrstuvwxyz";

const AUTH_TOKEN: string = MattermostConnection.toAuthToken({
  serverUrl: SERVER,
  accessToken: ACCESS_TOKEN,
  teamId: TEAM_ID,
  botUserId: BOT_ID,
});

interface RequestArgs {
  url: URL;
  data?: JSONObject | JSONArray;
  headers: Dictionary<string>;
  params?: Dictionary<string>;
  options: {
    retries: number;
    timeout: number;
    doNotFollowRedirects: boolean;
  };
}

interface ServerCall {
  method: string;
  path: string;
  args: RequestArgs;
}

type Answer = HTTPResponse<JSONObject> | HTTPErrorResponse;

type Route = (call: ServerCall) => Answer | undefined;

function ok(data: JSONObject | JSONArray): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data as JSONObject, {});
}

function refused(
  status: number,
  id: string,
  message: string,
): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { id: id, message: message }, {});
}

function channel(id: string, name: string, type: string): JSONObject {
  return {
    id: id,
    name: name,
    display_name: name.replace(/-/g, " ").toUpperCase(),
    type: type,
    team_id: TEAM_ID,
  };
}

describe("MattermostUtil: calls to the Mattermost server", () => {
  let calls: Array<ServerCall>;
  let routes: Array<Route>;

  const answer: (method: string) => (args: RequestArgs) => Promise<Answer> = (
    method: string,
  ) => {
    return async (args: RequestArgs): Promise<Answer> => {
      const path: string = args.url.toString().replace(SERVER, "");
      const call: ServerCall = { method: method, path: path, args: args };

      calls.push(call);

      for (const route of routes) {
        const found: Answer | undefined = route(call);

        if (found) {
          return found;
        }
      }

      return refused(404, "api.not_found", `No route for ${method} ${path}`);
    };
  };

  const on: (
    method: string,
    path: string | RegExp,
    reply: Answer | ((call: ServerCall) => Answer),
  ) => void = (
    method: string,
    path: string | RegExp,
    reply: Answer | ((call: ServerCall) => Answer),
  ): void => {
    routes.push((call: ServerCall): Answer | undefined => {
      const matches: boolean =
        call.method === method &&
        (typeof path === "string" ? call.path === path : path.test(call.path));

      if (!matches) {
        return undefined;
      }

      return typeof reply === "function" ? reply(call) : reply;
    });
  };

  let ssrfSpy: jest.SpyInstance;

  beforeEach(() => {
    calls = [];
    routes = [];

    jest.spyOn(API, "get").mockImplementation(answer("GET") as never);
    jest.spyOn(API, "post").mockImplementation(answer("POST") as never);
    jest.spyOn(API, "put").mockImplementation(answer("PUT") as never);
    jest.spyOn(API, "delete").mockImplementation(answer("DELETE") as never);

    ssrfSpy = jest
      .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("every call", () => {
    test("goes to the server with the bot's token, follows no redirect, and is time-limited", async () => {
      on(
        "GET",
        "/api/v4/users/me",
        ok({ id: BOT_ID, username: "oneuptime", is_bot: true }),
      );

      await MattermostUtil.getBotAccount({
        serverUrl: SERVER,
        accessToken: ACCESS_TOKEN,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.args.headers["Authorization"]).toBe(
        `Bearer ${ACCESS_TOKEN}`,
      );
      expect(calls[0]!.args.options.doNotFollowRedirects).toBe(true);
      expect(calls[0]!.args.options.timeout).toBe(
        MattermostUtil.REQUEST_TIMEOUT_IN_MS,
      );
    });

    test("is held to what OneUptime may reach, as an address a member typed", async () => {
      on("GET", "/api/v4/users/me", ok({ id: BOT_ID, username: "oneuptime" }));

      await MattermostUtil.getBotAccount({
        serverUrl: SERVER,
        accessToken: ACCESS_TOKEN,
      });

      expect(ssrfSpy).toHaveBeenCalledWith(SERVER, {
        allowPrivateNetworkTargets: true,
        targetLabel: "Mattermost server address",
      });
    });

    test("is not made when the server is not one OneUptime may reach", async () => {
      ssrfSpy.mockRejectedValue(
        new BadDataException(
          "Mattermost server address resolves to a private network address.",
        ),
      );

      await expect(
        MattermostUtil.getBotAccount({
          serverUrl: "http://10.0.0.1",
          accessToken: ACCESS_TOKEN,
        }),
      ).rejects.toThrow("resolves to a private network address");

      expect(calls).toHaveLength(0);
    });

    test("a refusal carries what Mattermost said, its status and its error id", async () => {
      on(
        "GET",
        "/api/v4/users/me",
        refused(
          401,
          "api.context.session_expired.app_error",
          "Invalid or expired session, please login again.",
        ),
      );

      let error: unknown = undefined;

      try {
        await MattermostUtil.getBotAccount({
          serverUrl: SERVER,
          accessToken: ACCESS_TOKEN,
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(MattermostRequestError);
      expect((error as MattermostRequestError).statusCode).toBe(401);
      expect((error as MattermostRequestError).errorId).toBe(
        "api.context.session_expired.app_error",
      );
      expect((error as Error).message).toBe(
        "Error from Mattermost: Invalid or expired session, please login again.",
      );
    });

    test("a connection that cannot be read makes no call", async () => {
      await expect(
        MattermostUtil.getChannel({
          authToken: "xoxb-a-slack-token",
          channelId: PUBLIC_CHANNEL_ID,
        }),
      ).rejects.toThrow("could not be read");

      expect(calls).toHaveLength(0);
    });

    test("an id that is not one Mattermost made is never placed in a path", async () => {
      await expect(
        MattermostUtil.getChannel({
          authToken: AUTH_TOKEN,
          channelId: "../users/me",
        }),
      ).rejects.toThrow("The Mattermost channel id is not valid.");

      await expect(
        MattermostUtil.isUserInChannel({
          authToken: AUTH_TOKEN,
          channelId: PUBLIC_CHANNEL_ID,
          userId: "x/../../y",
        }),
      ).rejects.toThrow("The Mattermost user id is not valid.");

      expect(calls).toHaveLength(0);
    });
  });

  describe("the bot and its teams", () => {
    test("reads whose bot a token is", async () => {
      on(
        "GET",
        "/api/v4/users/me",
        ok({
          id: BOT_ID,
          username: "oneuptime",
          first_name: "One",
          last_name: "Uptime",
          is_bot: true,
          roles: "system_user",
        }),
      );

      const bot: MattermostUser = await MattermostUtil.getBotAccount({
        serverUrl: SERVER,
        accessToken: ACCESS_TOKEN,
      });

      expect(bot).toEqual({
        id: BOT_ID,
        username: "oneuptime",
        displayName: "One Uptime",
        isBot: true,
        isGuest: false,
      });
    });

    test("lists the bot's teams, leaving out any it cannot read", async () => {
      on(
        "GET",
        "/api/v4/users/me/teams",
        ok([
          { id: TEAM_ID, name: "engineering", display_name: "Engineering" },
          { id: "not-an-id", name: "broken" },
        ]),
      );

      expect(
        await MattermostUtil.getTeamsOfBot({
          serverUrl: SERVER,
          accessToken: ACCESS_TOKEN,
        }),
      ).toEqual([
        { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
      ]);
    });
  });

  describe("people", () => {
    test("finds an account by its username, with or without @", async () => {
      on(
        "GET",
        "/api/v4/users/username/alice",
        ok({ id: ALICE_ID, username: "alice" }),
      );

      const found: MattermostUser | null =
        await MattermostUtil.findUserByUsername({
          authToken: AUTH_TOKEN,
          username: " @Alice ",
        });

      expect(found?.id).toBe(ALICE_ID);
    });

    test("a username that is not one is never asked about", async () => {
      expect(
        await MattermostUtil.findUserByUsername({
          authToken: AUTH_TOKEN,
          username: "../../users/me",
        }),
      ).toBeNull();

      expect(calls).toHaveLength(0);
    });

    test("no account of that username is null", async () => {
      expect(
        await MattermostUtil.findUserByUsername({
          authToken: AUTH_TOKEN,
          username: "nobody",
        }),
      ).toBeNull();
    });

    test("finds an account by email, and reads a server that hides emails as none found", async () => {
      on(
        "GET",
        "/api/v4/users/email/alice%40example.com",
        ok({ id: ALICE_ID, username: "alice" }),
      );

      expect(
        (
          await MattermostUtil.findUserByEmail({
            authToken: AUTH_TOKEN,
            email: "alice@example.com",
          })
        )?.username,
      ).toBe("alice");

      on(
        "GET",
        "/api/v4/users/email/bob%40example.com",
        refused(
          403,
          "api.context.permissions.app_error",
          "You do not have the appropriate permissions.",
        ),
      );

      expect(
        await MattermostUtil.findUserByEmail({
          authToken: AUTH_TOKEN,
          email: "bob@example.com",
        }),
      ).toBeNull();
    });

    test("an email that could steer the path is never asked about", async () => {
      for (const email of [
        "a/b@example.com",
        "a?b@example.com",
        "a b@example.com",
        "",
      ]) {
        expect(
          await MattermostUtil.findUserByEmail({
            authToken: AUTH_TOKEN,
            email,
          }),
        ).toBeNull();
      }

      expect(calls).toHaveLength(0);
    });

    test("a guest account is read as one", async () => {
      on(
        "GET",
        `/api/v4/users/${ALICE_ID}`,
        ok({ id: ALICE_ID, username: "alice", roles: "system_guest" }),
      );

      expect(
        (
          await MattermostUtil.getUser({
            authToken: AUTH_TOKEN,
            userId: ALICE_ID,
          })
        ).isGuest,
      ).toBe(true);
    });

    test("a username is read for a message, and none on a failure", async () => {
      on(
        "GET",
        `/api/v4/users/${ALICE_ID}`,
        ok({ id: ALICE_ID, username: "alice" }),
      );

      expect(
        await MattermostUtil.getUsernameFromUserId({
          authToken: AUTH_TOKEN,
          userId: ALICE_ID,
          projectId: ObjectID.generate(),
        }),
      ).toBe("alice");

      expect(
        await MattermostUtil.getUsernameFromUserId({
          authToken: AUTH_TOKEN,
          userId: BOB_ID,
          projectId: ObjectID.generate(),
        }),
      ).toBeNull();
    });
  });

  describe("channels", () => {
    test("creates a public channel in the connection's team, named as Mattermost takes it", async () => {
      on("POST", "/api/v4/channels", (call: ServerCall) => {
        return ok(
          channel(
            PUBLIC_CHANNEL_ID,
            (call.args.data as JSONObject)["name"] as string,
            "O",
          ),
        );
      });

      const created: WorkspaceChannel = await MattermostUtil.createChannel({
        authToken: AUTH_TOKEN,
        channelName: "INC 42",
        projectId: ObjectID.generate(),
      });

      expect(calls[0]!.args.data).toEqual({
        team_id: TEAM_ID,
        name: "inc-42",
        display_name: "inc-42",
        type: "O",
      });
      expect(created).toMatchObject({
        id: PUBLIC_CHANNEL_ID,
        name: "inc-42",
        workspaceType: WorkspaceType.Mattermost,
      });
    });

    test("creates a private channel for a private record", async () => {
      on(
        "POST",
        "/api/v4/channels",
        ok(channel(PRIVATE_CHANNEL_ID, "inc-43", "P")),
      );

      await MattermostUtil.createChannel({
        authToken: AUTH_TOKEN,
        channelName: "inc-43",
        projectId: ObjectID.generate(),
        isPrivate: true,
      });

      expect((calls[0]!.args.data as JSONObject)["type"]).toBe("P");
    });

    test("a name in use is refused as taken, so the next name is tried", async () => {
      on(
        "POST",
        "/api/v4/channels",
        refused(
          400,
          "store.sql_channel.save_channel.exists.app_error",
          "A channel with that name already exists on the same team.",
        ),
      );

      let error: unknown = undefined;

      try {
        await MattermostUtil.createChannel({
          authToken: AUTH_TOKEN,
          channelName: "inc-42",
          projectId: ObjectID.generate(),
        });
      } catch (err) {
        error = err;
      }

      expect(MattermostUtil.isChannelNameTakenError(error)).toBe(true);
    });

    test("finds a channel by its handle, a # or ~ in front left out", async () => {
      on(
        "GET",
        `/api/v4/teams/${TEAM_ID}/channels/name/incidents`,
        ok(channel(PUBLIC_CHANNEL_ID, "incidents", "O")),
      );

      expect(
        (
          await MattermostUtil.findChannelByName({
            authToken: AUTH_TOKEN,
            channelName: "~Incidents",
          })
        )?.id,
      ).toBe(PUBLIC_CHANNEL_ID);

      expect(
        (
          await MattermostUtil.findChannelByName({
            authToken: AUTH_TOKEN,
            channelName: "#incidents",
          })
        )?.id,
      ).toBe(PUBLIC_CHANNEL_ID);
    });

    test("finds a channel by its display name among those the bot can post in", async () => {
      on(
        "GET",
        `/api/v4/teams/${TEAM_ID}/channels`,
        ok([channel(PUBLIC_CHANNEL_ID, "ops-room", "O")]),
      );
      on("GET", `/api/v4/users/${BOT_ID}/teams/${TEAM_ID}/channels`, ok([]));

      expect(
        (
          await MattermostUtil.findChannelByName({
            authToken: AUTH_TOKEN,
            channelName: "OPS ROOM",
          })
        )?.id,
      ).toBe(PUBLIC_CHANNEL_ID);
    });

    test("no channel of that name is null, and says so as not existing", async () => {
      on("GET", `/api/v4/teams/${TEAM_ID}/channels`, ok([]));
      on("GET", `/api/v4/users/${BOT_ID}/teams/${TEAM_ID}/channels`, ok([]));

      expect(
        await MattermostUtil.doesChannelExist({
          authToken: AUTH_TOKEN,
          channelName: "missing",
          projectId: ObjectID.generate(),
        }),
      ).toBe(false);

      await expect(
        MattermostUtil.getWorkspaceChannelFromChannelName({
          authToken: AUTH_TOKEN,
          channelName: "missing",
          projectId: ObjectID.generate(),
        }),
      ).rejects.toThrow("add OneUptime's bot to it");
    });

    test("lists every page of public channels and the private ones the bot is in, never a direct message", async () => {
      const firstPage: JSONArray = Array.from(
        { length: 200 },
        (_: unknown, i: number) => {
          return channel(
            `${"c".repeat(23)}${String(i).padStart(3, "0")}`,
            `channel-${i}`,
            "O",
          );
        },
      );

      on("GET", `/api/v4/teams/${TEAM_ID}/channels`, (call: ServerCall) => {
        return ok(
          call.args.params?.["page"] === "0"
            ? firstPage
            : [channel(PUBLIC_CHANNEL_ID, "last", "O")],
        );
      });
      on(
        "GET",
        `/api/v4/users/${BOT_ID}/teams/${TEAM_ID}/channels`,
        ok([
          channel(PRIVATE_CHANNEL_ID, "secret", "P"),
          channel("d".repeat(26), `${BOT_ID}__${ALICE_ID}`, "D"),
          channel(PUBLIC_CHANNEL_ID, "last", "O"),
        ]),
      );

      const channels: Dictionary<WorkspaceChannel> =
        await MattermostUtil.getAllWorkspaceChannels({
          authToken: AUTH_TOKEN,
          projectId: ObjectID.generate(),
        });

      expect(Object.keys(channels)).toHaveLength(202);
      expect(channels[PRIVATE_CHANNEL_ID]?.name).toBe("secret");
      expect(channels["d".repeat(26)]).toBeUndefined();

      const pageCalls: Array<ServerCall> = calls.filter((call: ServerCall) => {
        return call.path === `/api/v4/teams/${TEAM_ID}/channels`;
      });

      expect(
        pageCalls.map((call: ServerCall) => {
          return call.args.params;
        }),
      ).toEqual([
        { page: "0", per_page: "200" },
        { page: "1", per_page: "200" },
      ]);
    });

    test("adds people to a channel looked up once, every one tried", async () => {
      on(
        "GET",
        `/api/v4/teams/${TEAM_ID}/channels/name/inc-42`,
        ok(channel(PUBLIC_CHANNEL_ID, "inc-42", "O")),
      );
      on(
        "POST",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}/members`,
        (call: ServerCall) => {
          return (call.args.data as JSONObject)["user_id"] === ALICE_ID
            ? refused(
                403,
                "api.channel.add_members.user_denied",
                "Guest accounts cannot join this channel.",
              )
            : ok({ user_id: BOB_ID });
        },
      );

      await expect(
        MattermostUtil.inviteUsersToChannels({
          authToken: AUTH_TOKEN,
          workspaceChannelInvitationPayload: {
            channelNames: ["inc-42"],
            workspaceUserIds: [ALICE_ID, BOB_ID],
          },
          projectId: ObjectID.generate(),
        }),
      ).rejects.toThrow("Guest accounts cannot join this channel.");

      const lookups: Array<ServerCall> = calls.filter((call: ServerCall) => {
        return call.path.includes("/channels/name/");
      });
      const adds: Array<JSONObject> = calls
        .filter((call: ServerCall) => {
          return call.method === "POST";
        })
        .map((call: ServerCall) => {
          return call.args.data as JSONObject;
        });

      expect(lookups).toHaveLength(1);
      expect(adds).toEqual([{ user_id: ALICE_ID }, { user_id: BOB_ID }]);
    });

    test("whether somebody is in a channel: a membership, or not found", async () => {
      on(
        "GET",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}/members/${ALICE_ID}`,
        ok({ user_id: ALICE_ID }),
      );

      expect(
        await MattermostUtil.isUserInChannel({
          authToken: AUTH_TOKEN,
          channelId: PUBLIC_CHANNEL_ID,
          userId: ALICE_ID,
        }),
      ).toBe(true);

      expect(
        await MattermostUtil.isUserInChannel({
          authToken: AUTH_TOKEN,
          channelId: PUBLIC_CHANNEL_ID,
          userId: BOB_ID,
        }),
      ).toBe(false);
    });

    test("archives each channel after a last message, going on past one it cannot", async () => {
      on("POST", "/api/v4/posts", ok({ id: POST_ID }));
      on(
        "DELETE",
        `/api/v4/channels/${PRIVATE_CHANNEL_ID}`,
        refused(
          403,
          "api.context.permissions.app_error",
          "You do not have the appropriate permissions.",
        ),
      );
      on(
        "DELETE",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}`,
        ok({ status: "OK" }),
      );

      await MattermostUtil.archiveChannels({
        channelIds: [PRIVATE_CHANNEL_ID, PUBLIC_CHANNEL_ID],
        authToken: AUTH_TOKEN,
        userId: BOT_ID,
        sendMessageBeforeArchiving: {
          _type: "WorkspacePayloadMarkdown",
          text: "Incident resolved. Archiving this channel.",
        },
        projectId: ObjectID.generate(),
      });

      expect(
        calls.map((call: ServerCall) => {
          return `${call.method} ${call.path}`;
        }),
      ).toEqual([
        "POST /api/v4/posts",
        `DELETE /api/v4/channels/${PRIVATE_CHANNEL_ID}`,
        "POST /api/v4/posts",
        `DELETE /api/v4/channels/${PUBLIC_CHANNEL_ID}`,
      ]);
      expect((calls[0]!.args.data as JSONObject)["message"]).toBe(
        "Incident resolved. Archiving this channel.",
      );
    });
  });

  describe("messages", () => {
    const blocks: Array<WorkspaceMessageBlock> = [
      {
        _type: "WorkspacePayloadMarkdown",
        text: "**INC-42** Checkout is down",
      },
      {
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: "Acknowledge",
            value: "5a1d8e1c-6b2f-4e36-9c1e-0f2a3b4c5d6e",
            actionId: SlackActionType.AcknowledgeIncident,
          },
        ],
      },
    ] as Array<WorkspaceMessageBlock>;

    test("posts to channels by id and by name, each once, with the message's buttons", async () => {
      on(
        "GET",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}`,
        ok(channel(PUBLIC_CHANNEL_ID, "incidents", "O")),
      );
      on(
        "GET",
        `/api/v4/teams/${TEAM_ID}/channels/name/incidents`,
        ok(channel(PUBLIC_CHANNEL_ID, "incidents", "O")),
      );
      on("POST", "/api/v4/posts", ok({ id: POST_ID }));

      const response: WorkspaceSendMessageResponse =
        await MattermostUtil.sendMessage({
          workspaceMessagePayload: {
            _type: "WorkspaceMessagePayload",
            workspaceType: WorkspaceType.Mattermost,
            messageBlocks: blocks,
            channelIds: [PUBLIC_CHANNEL_ID],
            channelNames: ["#incidents"],
            text: "INC-42 Checkout is down",
          },
          authToken: AUTH_TOKEN,
          userId: "",
          projectId: ObjectID.generate(),
        });

      const posts: Array<ServerCall> = calls.filter((call: ServerCall) => {
        return call.method === "POST" && call.path === "/api/v4/posts";
      });

      expect(posts).toHaveLength(1);
      expect(posts[0]!.args.data).toMatchObject({
        channel_id: PUBLIC_CHANNEL_ID,
        message: "**INC-42** Checkout is down",
      });
      expect(
        (
          ((posts[0]!.args.data as JSONObject)["props"] as JSONObject)[
            "attachments"
          ] as JSONArray
        )[0]!["actions"],
      ).toHaveLength(1);
      expect(response).toEqual({
        threads: [
          {
            channel: {
              id: PUBLIC_CHANNEL_ID,
              name: "incidents",
              workspaceType: WorkspaceType.Mattermost,
            },
            threadId: POST_ID,
          },
        ],
        workspaceType: WorkspaceType.Mattermost,
        errors: [],
      });
    });

    test("joins a public channel it is not in yet, and posts again", async () => {
      let attempts: number = 0;

      on(
        "GET",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}`,
        ok(channel(PUBLIC_CHANNEL_ID, "ops", "O")),
      );
      on("POST", "/api/v4/posts", () => {
        attempts++;

        return attempts === 1
          ? refused(
              403,
              "api.context.permissions.app_error",
              "You do not have the appropriate permissions.",
            )
          : ok({ id: POST_ID });
      });
      on(
        "POST",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}/members`,
        ok({ user_id: BOT_ID }),
      );

      const response: WorkspaceSendMessageResponse =
        await MattermostUtil.sendMessage({
          workspaceMessagePayload: {
            _type: "WorkspaceMessagePayload",
            workspaceType: WorkspaceType.Mattermost,
            messageBlocks: blocks,
            channelIds: [PUBLIC_CHANNEL_ID],
            channelNames: [],
          },
          authToken: AUTH_TOKEN,
          userId: "",
          projectId: ObjectID.generate(),
        });

      expect(response.threads).toHaveLength(1);
      expect(response.errors).toEqual([]);

      const join: ServerCall | undefined = calls.find((call: ServerCall) => {
        return call.path === `/api/v4/channels/${PUBLIC_CHANNEL_ID}/members`;
      });

      expect(join?.args.data).toEqual({ user_id: BOT_ID });
    });

    test("a private channel the bot is not in is an error saying to add the bot", async () => {
      on(
        "GET",
        `/api/v4/channels/${PRIVATE_CHANNEL_ID}`,
        ok(channel(PRIVATE_CHANNEL_ID, "secret", "P")),
      );
      on(
        "POST",
        "/api/v4/posts",
        refused(
          403,
          "api.context.permissions.app_error",
          "You do not have the appropriate permissions.",
        ),
      );

      const response: WorkspaceSendMessageResponse =
        await MattermostUtil.sendMessage({
          workspaceMessagePayload: {
            _type: "WorkspaceMessagePayload",
            workspaceType: WorkspaceType.Mattermost,
            messageBlocks: blocks,
            channelIds: [PRIVATE_CHANNEL_ID],
            channelNames: [],
          },
          authToken: AUTH_TOKEN,
          userId: "",
          projectId: ObjectID.generate(),
        });

      expect(response.threads).toHaveLength(0);
      expect(response.errors?.[0]?.error).toContain(
        "Add the bot to the channel in Mattermost",
      );
      expect(
        calls.some((call: ServerCall) => {
          return call.path.endsWith("/members");
        }),
      ).toBe(false);
    });

    test("a channel the message is not for is left out", async () => {
      on(
        "GET",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}`,
        ok(channel(PUBLIC_CHANNEL_ID, "ops", "O")),
      );

      const response: WorkspaceSendMessageResponse =
        await MattermostUtil.sendMessage({
          workspaceMessagePayload: {
            _type: "WorkspaceMessagePayload",
            workspaceType: WorkspaceType.Mattermost,
            messageBlocks: blocks,
            channelIds: [PUBLIC_CHANNEL_ID],
            channelNames: [],
            exceptChannelIds: [PUBLIC_CHANNEL_ID],
          },
          authToken: AUTH_TOKEN,
          userId: "",
          projectId: ObjectID.generate(),
        });

      expect(response.threads).toHaveLength(0);
      expect(
        calls.some((call: ServerCall) => {
          return call.path === "/api/v4/posts";
        }),
      ).toBe(false);
    });

    test("a channel name that names nothing is an error, and the other channels are posted to", async () => {
      on("GET", `/api/v4/teams/${TEAM_ID}/channels`, ok([]));
      on("GET", `/api/v4/users/${BOT_ID}/teams/${TEAM_ID}/channels`, ok([]));
      on(
        "GET",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}`,
        ok(channel(PUBLIC_CHANNEL_ID, "ops", "O")),
      );
      on("POST", "/api/v4/posts", ok({ id: POST_ID }));

      const response: WorkspaceSendMessageResponse =
        await MattermostUtil.sendMessage({
          workspaceMessagePayload: {
            _type: "WorkspaceMessagePayload",
            workspaceType: WorkspaceType.Mattermost,
            messageBlocks: blocks,
            channelIds: [PUBLIC_CHANNEL_ID],
            channelNames: ["missing"],
          },
          authToken: AUTH_TOKEN,
          userId: "",
          projectId: ObjectID.generate(),
        });

      expect(response.threads).toHaveLength(1);
      expect(response.errors).toHaveLength(1);
      expect(response.errors![0]!.channel.name).toBe("missing");
    });

    test("edits a post in place", async () => {
      on("PUT", `/api/v4/posts/${POST_ID}/patch`, ok({ id: POST_ID }));

      await MattermostUtil.updateMessage({
        authToken: AUTH_TOKEN,
        projectId: ObjectID.generate(),
        location: { channelId: PUBLIC_CHANNEL_ID },
        messageId: POST_ID,
        messageBlocks: blocks,
      });

      expect(calls[0]!.args.data).toMatchObject({
        message: "**INC-42** Checkout is down",
      });
      expect((calls[0]!.args.data as JSONObject)["props"]).toBeDefined();
    });

    test("a post that was deleted is gone: a new one is posted instead", async () => {
      on(
        "PUT",
        `/api/v4/posts/${POST_ID}/patch`,
        refused(404, "app.post.get.app_error", "Unable to get the post."),
      );

      let error: unknown = undefined;

      try {
        await MattermostUtil.updateMessage({
          authToken: AUTH_TOKEN,
          projectId: ObjectID.generate(),
          location: { channelId: PUBLIC_CHANNEL_ID },
          messageId: POST_ID,
          messageBlocks: blocks,
        });
      } catch (err) {
        error = err;
      }

      expect(MattermostUtil.isMessageGoneError(error)).toBe(true);
    });

    test("sends a direct message from the bot", async () => {
      on(
        "POST",
        "/api/v4/channels/direct",
        ok({ id: "d".repeat(26), type: "D" }),
      );
      on("POST", "/api/v4/posts", ok({ id: POST_ID }));

      await MattermostUtil.sendDirectMessageToUser({
        authToken: AUTH_TOKEN,
        workspaceUserId: ALICE_ID,
        messageBlocks: [
          { _type: "WorkspacePayloadMarkdown", text: "You are on call." },
        ] as Array<WorkspaceMessageBlock>,
      });

      expect(calls[0]!.args.data).toEqual([BOT_ID, ALICE_ID]);
      expect(calls[1]!.args.data).toEqual({
        message: "You are on call.",
        channel_id: "d".repeat(26),
      });
    });

    test("opens a form for whoever pressed, posting its submission back to OneUptime", async () => {
      on("POST", "/api/v4/actions/dialogs/open", ok({ status: "OK" }));

      await MattermostUtil.showModalToUser({
        authToken: AUTH_TOKEN,
        triggerId: "trigger-123",
        modalBlock: {
          _type: "WorkspaceModalBlock",
          title: "Add Note",
          actionId: SlackActionType.SubmitIncidentNote,
          actionValue: "5a1d8e1c-6b2f-4e36-9c1e-0f2a3b4c5d6e",
          submitButtonTitle: "Submit",
          cancelButtonTitle: "Cancel",
          blocks: [
            {
              _type: "WorkspaceTextAreaBlock",
              label: "Note",
              blockId: "note",
              placeholder: "Note",
            },
          ] as Array<WorkspaceMessageBlock>,
        },
      });

      const body: JSONObject = calls[0]!.args.data as JSONObject;

      expect(body["trigger_id"]).toBe("trigger-123");
      expect(body["url"]).toBe(
        MattermostUtil.getIntegrationUrl(MATTERMOST_DIALOG_PATH),
      );
      expect((body["dialog"] as JSONObject)["callback_id"]).toBe(
        SlackActionType.SubmitIncidentNote,
      );
    });

    test("refuses to open a form without a trigger", async () => {
      await expect(
        MattermostUtil.showModalToUser({
          authToken: AUTH_TOKEN,
          triggerId: "",
          modalBlock: {
            _type: "WorkspaceModalBlock",
            title: "Add Note",
            actionId: SlackActionType.SubmitIncidentNote,
            actionValue: "",
            submitButtonTitle: "Submit",
            cancelButtonTitle: "Cancel",
            blocks: [],
          },
        }),
      ).rejects.toThrow("The Mattermost trigger id is not valid.");

      expect(calls).toHaveLength(0);
    });
  });

  describe("incoming webhooks", () => {
    test("posts the text, held to what OneUptime may reach strictly, following no redirect", async () => {
      on("POST", /hooks/, ok({}));

      await MattermostUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString("https://chat.example.com/hooks/abc123"),
        text: "Status page: @channel the site is down",
      });

      expect(ssrfSpy).toHaveBeenCalledWith(
        "https://chat.example.com/hooks/abc123",
        { targetLabel: "Mattermost webhook URL" },
      );
      expect((calls[0]!.args.data as JSONObject)["text"]).toBe(
        "Status page: @⁠channel the site is down",
      );
      expect(calls[0]!.args.options.doNotFollowRedirects).toBe(true);
    });
  });
});
