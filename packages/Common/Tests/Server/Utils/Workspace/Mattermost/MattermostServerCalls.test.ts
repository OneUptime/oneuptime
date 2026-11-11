import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import MattermostUtil, {
  MATTERMOST_DIALOG_PATH,
  MattermostRequestError,
  MattermostUser,
} from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostConnection from "../../../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import MattermostActionContext from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActionContext";
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
// Another team of the server the bot is a member of (MattermostTeams).
const OTHER_TEAM_ID: string = "o".repeat(26);
const OTHER_CHANNEL_ID: string = "q".repeat(26);
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

function channel(
  id: string,
  name: string,
  type: string,
  teamId: string = TEAM_ID,
): JSONObject {
  return {
    id: id,
    name: name,
    display_name: name.replace(/-/g, " ").toUpperCase(),
    type: type,
    // A direct or group message belongs to no team.
    team_id: type === "D" || type === "G" ? "" : teamId,
  };
}

// The signed context of a post's first button (MattermostActionContext).
function contextOfFirstButton(post: JSONObject): JSONObject {
  const attachment: JSONObject = (
    (post["props"] as JSONObject)["attachments"] as Array<JSONObject>
  )[0]!;

  return (
    (attachment["actions"] as Array<JSONObject>)[0]![
      "integration"
    ] as JSONObject
  )["context"] as JSONObject;
}

// Whether a press from this team, in this channel, verifies against it.
function isSignedFor(
  context: JSONObject,
  from: { teamId: string; channelId?: string },
): boolean {
  return Boolean(
    MattermostActionContext.readPress({
      context: context,
      teamId: from.teamId,
      channelId: from.channelId,
    }),
  );
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

    test("lists the bot's teams each once, leaving out an archived team", async () => {
      on(
        "GET",
        "/api/v4/users/me/teams",
        ok([
          { id: TEAM_ID, name: "engineering", display_name: "Engineering" },
          { id: OTHER_TEAM_ID, name: "support", display_name: "Support" },
          { id: TEAM_ID, name: "engineering", display_name: "Engineering" },
          {
            id: "r".repeat(26),
            name: "retired",
            display_name: "Retired",
            delete_at: 1700000000000,
          },
        ]),
      );

      expect(
        await MattermostUtil.getTeamsOfBot({
          serverUrl: SERVER,
          accessToken: ACCESS_TOKEN,
        }),
      ).toEqual([
        { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
        { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
      ]);
    });

    test("an answer that is not a list of teams is refused, rather than read as none", async () => {
      on("GET", "/api/v4/users/me/teams", ok({ id: TEAM_ID }));

      await expect(
        MattermostUtil.getTeamsOfBot({
          serverUrl: SERVER,
          accessToken: ACCESS_TOKEN,
        }),
      ).rejects.toThrow(
        "Mattermost answered with a list of teams OneUptime could not read.",
      );
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

    test("an account's email address and whether it was deactivated are read when Mattermost says", async () => {
      on(
        "GET",
        `/api/v4/users/${ALICE_ID}`,
        ok({
          id: ALICE_ID,
          username: "alice",
          email: " alice@example.com ",
          delete_at: 1700000000000,
        }),
      );
      on(
        "GET",
        `/api/v4/users/${BOB_ID}`,
        ok({ id: BOB_ID, username: "bob", delete_at: 0 }),
      );

      expect(
        await MattermostUtil.getUser({
          authToken: AUTH_TOKEN,
          userId: ALICE_ID,
        }),
      ).toEqual({
        id: ALICE_ID,
        username: "alice",
        displayName: "",
        isBot: false,
        isGuest: false,
        email: "alice@example.com",
        isDeactivated: true,
      });
      // A server that hides email addresses leaves it out; nothing is made up.
      expect(
        await MattermostUtil.getUser({
          authToken: AUTH_TOKEN,
          userId: BOB_ID,
        }),
      ).toEqual({
        id: BOB_ID,
        username: "bob",
        displayName: "",
        isBot: false,
        isGuest: false,
      });
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
      // Found in the default team: the bot's other teams are never asked for.
      expect(
        calls.some((call: ServerCall) => {
          return call.path === "/api/v4/users/me/teams";
        }),
      ).toBe(false);
    });

    test("no channel of that name is null, and says so as not existing", async () => {
      on("GET", `/api/v4/teams/${TEAM_ID}/channels`, ok([]));
      on("GET", `/api/v4/users/${BOT_ID}/teams/${TEAM_ID}/channels`, ok([]));
      on(
        "GET",
        "/api/v4/users/me/teams",
        ok([{ id: TEAM_ID, name: "engineering", display_name: "Engineering" }]),
      );

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

    describe("who is in a channel", () => {
      test("asks for its people with their names, in one call a page", async () => {
        on(
          "GET",
          "/api/v4/users",
          ok([
            {
              id: ALICE_ID,
              username: "alice",
              first_name: "Alice",
              last_name: "Smith",
              email: "alice@example.com",
            },
            { id: BOT_ID, username: "oneuptime", is_bot: true },
          ]),
        );

        expect(
          await MattermostUtil.getChannelMembers({
            authToken: AUTH_TOKEN,
            channelId: PRIVATE_CHANNEL_ID,
            max: 1000,
          }),
        ).toEqual([
          {
            id: ALICE_ID,
            username: "alice",
            displayName: "Alice Smith",
            isBot: false,
            isGuest: false,
            email: "alice@example.com",
          },
          {
            id: BOT_ID,
            username: "oneuptime",
            displayName: "",
            isBot: true,
            isGuest: false,
          },
        ]);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.path).toBe("/api/v4/users");
        expect(calls[0]!.args.params).toEqual({
          in_channel: PRIVATE_CHANNEL_ID,
          page: "0",
          per_page: "200",
        });
        expect(calls[0]!.args.headers["Authorization"]).toBe(
          `Bearer ${ACCESS_TOKEN}`,
        );
        expect(calls[0]!.args.options.doNotFollowRedirects).toBe(true);
      });

      test("reads page by page until a page is short, and no further than `max`", async () => {
        const page: (from: number, length: number) => Array<JSONObject> = (
          from: number,
          length: number,
        ): Array<JSONObject> => {
          return Array.from({ length: length }, (_: unknown, index: number) => {
            return {
              id: String(from + index).padStart(26, "u"),
              username: `user${from + index}`,
            };
          });
        };

        on("GET", "/api/v4/users", (call: ServerCall) => {
          return ok(
            call.args.params?.["page"] === "0" ? page(0, 200) : page(200, 3),
          );
        });

        expect(
          await MattermostUtil.getChannelMembers({
            authToken: AUTH_TOKEN,
            channelId: PRIVATE_CHANNEL_ID,
            max: 1000,
          }),
        ).toHaveLength(203);
        expect(calls).toHaveLength(2);

        calls.length = 0;

        const limited: Array<MattermostUser> =
          await MattermostUtil.getChannelMembers({
            authToken: AUTH_TOKEN,
            channelId: PRIVATE_CHANNEL_ID,
            max: 50,
          });

        expect(limited).toHaveLength(50);
        expect(calls).toHaveLength(1);
      });

      test("a server that repeats a page cannot hold a read: at most max / 200 pages are asked for", async () => {
        const page: Array<JSONObject> = Array.from(
          { length: 200 },
          (_: unknown, index: number) => {
            return {
              id: String(index).padStart(26, "u"),
              username: `user${index}`,
            };
          },
        );

        on("GET", "/api/v4/users", ok(page));

        expect(
          await MattermostUtil.getChannelMembers({
            authToken: AUTH_TOKEN,
            channelId: PRIVATE_CHANNEL_ID,
            max: 1000,
          }),
        ).toHaveLength(200);
        expect(calls).toHaveLength(5);
      });

      test("an entry OneUptime cannot read is left out", async () => {
        on(
          "GET",
          "/api/v4/users",
          ok([
            { id: ALICE_ID, username: "alice" },
            { id: "not an id", username: "mallory" },
            null as unknown as JSONObject,
          ]),
        );

        expect(
          (
            await MattermostUtil.getChannelMembers({
              authToken: AUTH_TOKEN,
              channelId: PRIVATE_CHANNEL_ID,
              max: 1000,
            })
          ).map((member: MattermostUser) => {
            return member.id;
          }),
        ).toEqual([ALICE_ID]);
      });

      test("an answer that is not a list is refused, rather than taken for nobody", async () => {
        on("GET", "/api/v4/users", ok({ message: "Not a list" }));

        await expect(
          MattermostUtil.getChannelMembers({
            authToken: AUTH_TOKEN,
            channelId: PRIVATE_CHANNEL_ID,
            max: 1000,
          }),
        ).rejects.toBeInstanceOf(BadDataException);
      });

      test("a channel id is checked before anything is asked with it", async () => {
        for (const channelId of [
          "../../users/me",
          "short",
          `${PRIVATE_CHANNEL_ID}?in_team=x`,
          "",
        ]) {
          await expect(
            MattermostUtil.getChannelMembers({
              authToken: AUTH_TOKEN,
              channelId: channelId,
              max: 1000,
            }),
          ).rejects.toThrow("The Mattermost channel id is not valid.");
        }

        expect(calls).toHaveLength(0);
      });

      test("the server's address is held to what OneUptime may reach, before the token goes anywhere", async () => {
        on("GET", "/api/v4/users", ok([]));

        await MattermostUtil.getChannelMembers({
          authToken: AUTH_TOKEN,
          channelId: PRIVATE_CHANNEL_ID,
          max: 1000,
        });

        expect(ssrfSpy).toHaveBeenCalledWith(
          SERVER,
          expect.objectContaining({ allowPrivateNetworkTargets: true }),
        );
      });

      test("a bot that is not in the channel is refused, a public channel's too", async () => {
        on(
          "GET",
          "/api/v4/users",
          refused(
            403,
            "api.context.permissions.app_error",
            "You do not have the appropriate permissions.",
          ),
        );

        await expect(
          MattermostUtil.getChannelMembers({
            authToken: AUTH_TOKEN,
            channelId: PUBLIC_CHANNEL_ID,
            max: 1000,
          }),
        ).rejects.toBeInstanceOf(MattermostRequestError);
      });
    });

    test("an archived channel is read as one", async () => {
      on(
        "GET",
        `/api/v4/channels/${PRIVATE_CHANNEL_ID}`,
        ok({
          ...channel(PRIVATE_CHANNEL_ID, "inc-42", "P"),
          delete_at: 1700000000000,
        }),
      );
      on(
        "GET",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}`,
        ok({ ...channel(PUBLIC_CHANNEL_ID, "inc-43", "O"), delete_at: 0 }),
      );

      expect(
        (
          await MattermostUtil.getChannel({
            authToken: AUTH_TOKEN,
            channelId: PRIVATE_CHANNEL_ID,
          })
        ).isArchived,
      ).toBe(true);
      expect(
        (
          await MattermostUtil.getChannel({
            authToken: AUTH_TOKEN,
            channelId: PUBLIC_CHANNEL_ID,
          })
        ).isArchived,
      ).toBeUndefined();
    });

    describe("what a refusal says", () => {
      const error: (status: number, id: string) => MattermostRequestError = (
        status: number,
        id: string,
      ): MattermostRequestError => {
        return new MattermostRequestError({
          message: "Refused",
          statusCode: status,
          errorId: id,
        });
      };

      test("an account outside the team, on this server and an older one, and removed from it", () => {
        for (const refusal of [
          error(404, "app.team.get_member.missing.app_error"),
          error(404, "store.sql_team.get_member.missing.app_error"),
          error(
            400,
            "api.channel.add_user.to.channel.failed.deleted.app_error",
          ),
        ]) {
          expect(MattermostUtil.isNotInTeamError(refusal)).toBe(true);
          expect(MattermostUtil.isAccountGoneError(refusal)).toBe(false);
        }
      });

      test("an account that does not exist, on this server and an older one, and deactivated", () => {
        for (const refusal of [
          error(404, "app.user.missing_account.const"),
          error(404, "store.sql_user.missing_account.const"),
          error(403, "app.channel.add_member.deleted_user.app_error"),
        ]) {
          expect(MattermostUtil.isAccountGoneError(refusal)).toBe(true);
          expect(MattermostUtil.isNotInTeamError(refusal)).toBe(false);
        }
      });

      test("a channel that is gone is neither", () => {
        const gone: MattermostRequestError = error(
          404,
          "app.channel.get.existing.app_error",
        );

        expect(MattermostUtil.isNotInTeamError(gone)).toBe(false);
        expect(MattermostUtil.isAccountGoneError(gone)).toBe(false);
        expect(MattermostUtil.isNotFoundError(gone)).toBe(true);
      });

      test("a token it no longer takes", () => {
        expect(
          MattermostUtil.isUnauthorizedError(
            error(401, "api.context.session_expired.app_error"),
          ),
        ).toBe(true);
        expect(MattermostUtil.isUnauthorizedError(error(403, "x"))).toBe(false);
        expect(MattermostUtil.isUnauthorizedError(new Error("x"))).toBe(false);
      });

      test("down, its rate limit, or no answer at all: it could not answer now", () => {
        expect(MattermostUtil.isUnavailableError(error(500, "x"))).toBe(true);
        expect(MattermostUtil.isUnavailableError(error(503, "x"))).toBe(true);
        expect(MattermostUtil.isUnavailableError(error(429, "x"))).toBe(true);
        expect(MattermostUtil.isUnavailableError(new Error("ETIMEDOUT"))).toBe(
          true,
        );
        expect(MattermostUtil.isUnavailableError(error(403, "x"))).toBe(false);
        expect(MattermostUtil.isUnavailableError(error(400, "x"))).toBe(false);
      });
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

  /*
   * A post only one person sees (#6254): the answer to a form they sent - a
   * public note that waits for approval - in the channel they sent it from.
   */
  describe("a post only one person sees", () => {
    const PERSON_ID: string = "p".repeat(26);

    test("is Mattermost's ephemeral post, to them, in the channel, its mentions broken", async () => {
      on("POST", "/api/v4/posts/ephemeral", ok({ id: POST_ID }));

      await MattermostUtil.postEphemeral({
        authToken: AUTH_TOKEN,
        userId: PERSON_ID,
        channelId: PUBLIC_CHANNEL_ID,
        markdown: "⏳ Sent for approval. It waits for @channel and Bob.",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.method).toBe("POST");
      expect(calls[0]!.path).toBe("/api/v4/posts/ephemeral");
      expect(calls[0]!.args.headers["Authorization"]).toBe(
        `Bearer ${ACCESS_TOKEN}`,
      );

      const body: JSONObject = calls[0]!.args.data as JSONObject;

      expect(body["user_id"]).toBe(PERSON_ID);
      expect((body["post"] as JSONObject)["channel_id"]).toBe(
        PUBLIC_CHANNEL_ID,
      );
      // The text as every post writes it: no mention left to notify anyone.
      expect((body["post"] as JSONObject)["message"]).toBe(
        MattermostUtil.getMessageText(
          "⏳ Sent for approval. It waits for @channel and Bob.",
        ),
      );
      expect((body["post"] as JSONObject)["message"]).not.toContain("@channel");
      // Posting twice would show it twice: it is not tried again.
      expect(calls[0]!.args.options.retries).toBe(0);
    });

    test("is held to what a post takes", async () => {
      on("POST", "/api/v4/posts/ephemeral", ok({ id: POST_ID }));

      await MattermostUtil.postEphemeral({
        authToken: AUTH_TOKEN,
        userId: PERSON_ID,
        channelId: PUBLIC_CHANNEL_ID,
        markdown: "x".repeat(MattermostUtil.MESSAGE_MAX_LENGTH * 2),
      });

      const post: JSONObject = (calls[0]!.args.data as JSONObject)[
        "post"
      ] as JSONObject;

      expect(String(post["message"]).length).toBeLessThanOrEqual(
        MattermostUtil.MESSAGE_MAX_LENGTH,
      );
    });

    test("a person or a channel that is not a Mattermost id is never posted to", async () => {
      for (const ids of [
        { userId: "../../users/me", channelId: PUBLIC_CHANNEL_ID },
        { userId: PERSON_ID, channelId: "town-square" },
      ]) {
        await expect(
          MattermostUtil.postEphemeral({
            authToken: AUTH_TOKEN,
            userId: ids.userId,
            channelId: ids.channelId,
            markdown: "Sent for approval.",
          }),
        ).rejects.toThrow("is not valid");
      }

      expect(calls).toEqual([]);
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
    ] as unknown as Array<WorkspaceMessageBlock>;

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
              // The team it is in, kept with the channel (MattermostTeams).
              teamId: TEAM_ID,
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

    // The edit of a post, among the calls made: the channel may be read first.
    const patchOf: (postId: string) => JSONObject = (
      postId: string,
    ): JSONObject => {
      const patch: ServerCall | undefined = calls.find((call: ServerCall) => {
        return (
          call.method === "PUT" && call.path === `/api/v4/posts/${postId}/patch`
        );
      });

      expect(patch).toBeDefined();

      return patch!.args.data as JSONObject;
    };

    test("edits a post in place", async () => {
      on("PUT", `/api/v4/posts/${POST_ID}/patch`, ok({ id: POST_ID }));
      on(
        "GET",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}`,
        ok(channel(PUBLIC_CHANNEL_ID, "incidents", "O")),
      );

      await MattermostUtil.updateMessage({
        authToken: AUTH_TOKEN,
        projectId: ObjectID.generate(),
        location: { channelId: PUBLIC_CHANNEL_ID },
        messageId: POST_ID,
        messageBlocks: blocks,
      });

      expect(patchOf(POST_ID)).toMatchObject({
        message: "**INC-42** Checkout is down",
      });
      expect(patchOf(POST_ID)["props"]).toBeDefined();
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
        ] as unknown as Array<WorkspaceMessageBlock>,
      });

      expect(calls[0]!.args.data).toEqual([BOT_ID, ALICE_ID]);
      expect(calls[1]!.args.data).toEqual({
        message: "You are on call.",
        channel_id: "d".repeat(26),
      });
    });

    /*
     * Where it landed (#6317): the direct message channel and the post, what
     * an edit of it names - a public note's approval message is replaced
     * there once the note is decided.
     */
    test("a direct message says where it landed: its channel and its post", async () => {
      on(
        "POST",
        "/api/v4/channels/direct",
        ok({ id: "d".repeat(26), type: "D" }),
      );
      on("POST", "/api/v4/posts", ok({ id: POST_ID }));

      expect(
        await MattermostUtil.sendDirectMessageToUser({
          authToken: AUTH_TOKEN,
          workspaceUserId: ALICE_ID,
          messageBlocks: [
            { _type: "WorkspacePayloadMarkdown", text: "You are on call." },
          ] as unknown as Array<WorkspaceMessageBlock>,
        }),
      ).toEqual({ channelId: "d".repeat(26), messageId: POST_ID });
    });

    test("a direct message's post edited in place: what it says now, its link and no button", async () => {
      on("PUT", `/api/v4/posts/${POST_ID}/patch`, ok({ id: POST_ID }));

      await MattermostUtil.updateMessage({
        authToken: AUTH_TOKEN,
        projectId: ObjectID.generate(),
        location: { channelId: "d".repeat(26) },
        messageId: POST_ID,
        messageBlocks: [
          {
            _type: "WorkspacePayloadMarkdown",
            text: "✅ This public note was approved by **Bob**.",
          },
          {
            _type: "WorkspacePayloadButtons",
            buttons: [
              {
                _type: "WorkspaceMessagePayloadButton",
                title: "View in OneUptime",
                value: "",
                actionId: "OpenInOneUptime",
                url: URL.fromString("https://oneuptime.example/notes"),
              },
            ],
          },
        ] as unknown as Array<WorkspaceMessageBlock>,
      });

      const patch: JSONObject = patchOf(POST_ID);

      expect(patch["message"]).toBe(
        "✅ This public note was approved by **Bob**.",
      );

      const attachment: JSONObject = (
        (patch["props"] as JSONObject)["attachments"] as Array<JSONObject>
      )[0]!;

      expect(String(attachment["text"])).toContain(
        "https://oneuptime.example/notes",
      );
      expect(attachment["actions"]).toBeUndefined();
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
          ] as unknown as Array<WorkspaceMessageBlock>,
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

  /*
   * A bot in several teams of the server (MattermostTeams): channels are
   * found, created and posted to in the team a rule names, or in the
   * default team first - and each post's buttons are signed for the team of
   * the channel it is in, so a press there verifies.
   */
  describe("a bot in several teams", () => {
    const BOTH_TEAMS: JSONArray = [
      { id: TEAM_ID, name: "engineering", display_name: "Engineering" },
      { id: OTHER_TEAM_ID, name: "support", display_name: "Support" },
    ];

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
    ] as unknown as Array<WorkspaceMessageBlock>;

    const postsMade: () => Array<JSONObject> = (): Array<JSONObject> => {
      return calls
        .filter((call: ServerCall) => {
          return call.method === "POST" && call.path === "/api/v4/posts";
        })
        .map((call: ServerCall) => {
          return call.args.data as JSONObject;
        });
    };

    test("creates a channel in the team a rule names", async () => {
      on("POST", "/api/v4/channels", (call: ServerCall) => {
        return ok(
          channel(
            OTHER_CHANNEL_ID,
            (call.args.data as JSONObject)["name"] as string,
            "O",
            OTHER_TEAM_ID,
          ),
        );
      });

      const created: WorkspaceChannel = await MattermostUtil.createChannel({
        authToken: AUTH_TOKEN,
        channelName: "inc-42",
        projectId: ObjectID.generate(),
        teamId: OTHER_TEAM_ID,
      });

      expect((calls[0]!.args.data as JSONObject)["team_id"]).toBe(
        OTHER_TEAM_ID,
      );
      expect(created).toMatchObject({
        id: OTHER_CHANNEL_ID,
        teamId: OTHER_TEAM_ID,
      });
    });

    test("a team named that is not a Mattermost id is never sent", async () => {
      await expect(
        MattermostUtil.createChannel({
          authToken: AUTH_TOKEN,
          channelName: "inc-42",
          projectId: ObjectID.generate(),
          teamId: "../users/me",
        }),
      ).rejects.toThrow(BadDataException);

      expect(calls).toHaveLength(0);
    });

    test("a team the bot may not create channels in says to add the bot to it, or to choose another", async () => {
      on(
        "POST",
        "/api/v4/channels",
        refused(
          403,
          "api.context.permissions.app_error",
          "You do not have the appropriate permissions.",
        ),
      );

      await expect(
        MattermostUtil.createChannel({
          authToken: AUTH_TOKEN,
          channelName: "inc-42",
          projectId: ObjectID.generate(),
          teamId: OTHER_TEAM_ID,
        }),
      ).rejects.toThrow(
        "OneUptime's bot may not create channels in the Mattermost team this rule names. Add the bot to that team in Mattermost, or choose another team in the rule, then try again.",
      );

      // In the default team, Mattermost's own refusal is passed on.
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

      expect(error).toBeInstanceOf(MattermostRequestError);
    });

    test("a channel of the team a rule names is looked for there alone", async () => {
      on(
        "GET",
        `/api/v4/teams/${OTHER_TEAM_ID}/channels/name/incidents`,
        ok(channel(OTHER_CHANNEL_ID, "incidents", "O", OTHER_TEAM_ID)),
      );

      const found: WorkspaceChannel | null =
        await MattermostUtil.findChannelByName({
          authToken: AUTH_TOKEN,
          channelName: "#incidents",
          teamId: OTHER_TEAM_ID,
        });

      expect(found).toMatchObject({
        id: OTHER_CHANNEL_ID,
        teamId: OTHER_TEAM_ID,
      });
      expect(
        calls.map((call: ServerCall) => {
          return call.path;
        }),
      ).toEqual([`/api/v4/teams/${OTHER_TEAM_ID}/channels/name/incidents`]);
    });

    test("a channel the team a rule names does not have is none, even when another team has it", async () => {
      on(
        "GET",
        `/api/v4/teams/${TEAM_ID}/channels/name/incidents`,
        ok(channel(PUBLIC_CHANNEL_ID, "incidents", "O")),
      );
      on("GET", `/api/v4/teams/${OTHER_TEAM_ID}/channels`, ok([]));
      on(
        "GET",
        `/api/v4/users/${BOT_ID}/teams/${OTHER_TEAM_ID}/channels`,
        ok([]),
      );

      expect(
        await MattermostUtil.findChannelByName({
          authToken: AUTH_TOKEN,
          channelName: "incidents",
          teamId: OTHER_TEAM_ID,
        }),
      ).toBeNull();
      expect(
        calls.some((call: ServerCall) => {
          return (
            call.path === `/api/v4/teams/${TEAM_ID}/channels/name/incidents` ||
            call.path === "/api/v4/users/me/teams"
          );
        }),
      ).toBe(false);
    });

    test("without a team, the default team first, then the bot's other teams", async () => {
      on("GET", "/api/v4/users/me/teams", ok(BOTH_TEAMS));
      on(
        "GET",
        `/api/v4/teams/${OTHER_TEAM_ID}/channels/name/support-desk`,
        ok(channel(OTHER_CHANNEL_ID, "support-desk", "O", OTHER_TEAM_ID)),
      );

      const found: WorkspaceChannel | null =
        await MattermostUtil.findChannelByName({
          authToken: AUTH_TOKEN,
          channelName: "support-desk",
        });

      expect(found).toMatchObject({
        id: OTHER_CHANNEL_ID,
        teamId: OTHER_TEAM_ID,
      });
      expect(
        calls.map((call: ServerCall) => {
          return call.path;
        }),
      ).toEqual([
        `/api/v4/teams/${TEAM_ID}/channels/name/support-desk`,
        "/api/v4/users/me/teams",
        `/api/v4/teams/${OTHER_TEAM_ID}/channels/name/support-desk`,
      ]);
    });

    test("a handle in another team comes before a display name in the default team", async () => {
      on("GET", "/api/v4/users/me/teams", ok(BOTH_TEAMS));
      on(
        "GET",
        `/api/v4/teams/${OTHER_TEAM_ID}/channels/name/war-room`,
        ok(channel(OTHER_CHANNEL_ID, "war-room", "O", OTHER_TEAM_ID)),
      );
      on(
        "GET",
        `/api/v4/teams/${TEAM_ID}/channels`,
        ok([
          {
            ...channel(PUBLIC_CHANNEL_ID, "ops", "O"),
            display_name: "war-room",
          },
        ]),
      );
      on("GET", `/api/v4/users/${BOT_ID}/teams/${TEAM_ID}/channels`, ok([]));

      expect(
        (
          await MattermostUtil.findChannelByName({
            authToken: AUTH_TOKEN,
            channelName: "war-room",
          })
        )?.id,
      ).toBe(OTHER_CHANNEL_ID);
    });

    test("a display name only another team has is found there", async () => {
      on("GET", "/api/v4/users/me/teams", ok(BOTH_TEAMS));
      on("GET", `/api/v4/teams/${TEAM_ID}/channels`, ok([]));
      on("GET", `/api/v4/users/${BOT_ID}/teams/${TEAM_ID}/channels`, ok([]));
      on(
        "GET",
        `/api/v4/teams/${OTHER_TEAM_ID}/channels`,
        ok([channel(OTHER_CHANNEL_ID, "help-desk", "O", OTHER_TEAM_ID)]),
      );
      on(
        "GET",
        `/api/v4/users/${BOT_ID}/teams/${OTHER_TEAM_ID}/channels`,
        ok([]),
      );

      expect(
        (
          await MattermostUtil.findChannelByName({
            authToken: AUTH_TOKEN,
            channelName: "HELP DESK",
          })
        )?.id,
      ).toBe(OTHER_CHANNEL_ID);
    });

    test("a server that would not list the bot's teams fails the lookup, rather than calling the channel missing", async () => {
      on(
        "GET",
        "/api/v4/users/me/teams",
        refused(503, "api.server.unavailable", "Unavailable"),
      );

      await expect(
        MattermostUtil.findChannelByName({
          authToken: AUTH_TOKEN,
          channelName: "support-desk",
        }),
      ).rejects.toBeInstanceOf(MattermostRequestError);
    });

    test("a channel named in another team is posted to with its buttons signed for that team", async () => {
      on(
        "GET",
        `/api/v4/teams/${OTHER_TEAM_ID}/channels/name/incidents`,
        ok(channel(OTHER_CHANNEL_ID, "incidents", "O", OTHER_TEAM_ID)),
      );
      on("POST", "/api/v4/posts", ok({ id: POST_ID }));

      const response: WorkspaceSendMessageResponse =
        await MattermostUtil.sendMessage({
          workspaceMessagePayload: {
            _type: "WorkspaceMessagePayload",
            workspaceType: WorkspaceType.Mattermost,
            messageBlocks: blocks,
            channelNames: ["incidents"],
            channelIds: [],
            teamId: OTHER_TEAM_ID,
          },
          authToken: AUTH_TOKEN,
          userId: "",
          projectId: ObjectID.generate(),
        });

      expect(response.errors).toEqual([]);
      expect(response.threads[0]!.channel).toMatchObject({
        id: OTHER_CHANNEL_ID,
        teamId: OTHER_TEAM_ID,
      });

      const context: JSONObject = contextOfFirstButton(postsMade()[0]!);

      expect(isSignedFor(context, { teamId: OTHER_TEAM_ID })).toBe(true);
      expect(isSignedFor(context, { teamId: TEAM_ID })).toBe(false);
    });

    test("channels of two teams in one message: each post signed for its own channel's team", async () => {
      on(
        "GET",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}`,
        ok(channel(PUBLIC_CHANNEL_ID, "incidents", "O")),
      );
      on(
        "GET",
        `/api/v4/channels/${OTHER_CHANNEL_ID}`,
        ok(channel(OTHER_CHANNEL_ID, "incidents", "O", OTHER_TEAM_ID)),
      );
      on("POST", "/api/v4/posts", ok({ id: POST_ID }));

      await MattermostUtil.sendMessage({
        workspaceMessagePayload: {
          _type: "WorkspaceMessagePayload",
          workspaceType: WorkspaceType.Mattermost,
          messageBlocks: blocks,
          channelIds: [PUBLIC_CHANNEL_ID, OTHER_CHANNEL_ID],
          channelNames: [],
        },
        authToken: AUTH_TOKEN,
        userId: "",
        projectId: ObjectID.generate(),
      });

      const posts: Array<JSONObject> = postsMade();

      expect(
        posts.map((post: JSONObject) => {
          return post["channel_id"];
        }),
      ).toEqual([PUBLIC_CHANNEL_ID, OTHER_CHANNEL_ID]);
      expect(
        isSignedFor(contextOfFirstButton(posts[0]!), { teamId: TEAM_ID }),
      ).toBe(true);
      expect(
        isSignedFor(contextOfFirstButton(posts[1]!), {
          teamId: OTHER_TEAM_ID,
        }),
      ).toBe(true);
      expect(
        isSignedFor(contextOfFirstButton(posts[1]!), { teamId: TEAM_ID }),
      ).toBe(false);
    });

    test("an edit is signed for the team its location names, the channel not read", async () => {
      on("PUT", `/api/v4/posts/${POST_ID}/patch`, ok({ id: POST_ID }));

      await MattermostUtil.updateMessage({
        authToken: AUTH_TOKEN,
        projectId: ObjectID.generate(),
        location: { channelId: OTHER_CHANNEL_ID, teamId: OTHER_TEAM_ID },
        messageId: POST_ID,
        messageBlocks: blocks,
      });

      expect(calls).toHaveLength(1);
      expect(
        isSignedFor(contextOfFirstButton(calls[0]!.args.data as JSONObject), {
          teamId: OTHER_TEAM_ID,
        }),
      ).toBe(true);
    });

    test("an edit whose location names no team is signed as its channel says", async () => {
      on("PUT", `/api/v4/posts/${POST_ID}/patch`, ok({ id: POST_ID }));
      on(
        "GET",
        `/api/v4/channels/${OTHER_CHANNEL_ID}`,
        ok(channel(OTHER_CHANNEL_ID, "incidents", "O", OTHER_TEAM_ID)),
      );

      await MattermostUtil.updateMessage({
        authToken: AUTH_TOKEN,
        projectId: ObjectID.generate(),
        location: { channelId: OTHER_CHANNEL_ID },
        messageId: POST_ID,
        messageBlocks: blocks,
      });

      const patch: ServerCall = calls.find((call: ServerCall) => {
        return call.method === "PUT";
      })!;

      expect(
        isSignedFor(contextOfFirstButton(patch.args.data as JSONObject), {
          teamId: OTHER_TEAM_ID,
        }),
      ).toBe(true);
    });

    test("an edit of a direct message keeps its buttons held to its channel", async () => {
      const directChannelId: string = "d".repeat(26);

      on("PUT", `/api/v4/posts/${POST_ID}/patch`, ok({ id: POST_ID }));
      on(
        "GET",
        `/api/v4/channels/${directChannelId}`,
        ok(channel(directChannelId, `${BOT_ID}__${ALICE_ID}`, "D")),
      );

      await MattermostUtil.updateMessage({
        authToken: AUTH_TOKEN,
        projectId: ObjectID.generate(),
        location: { channelId: directChannelId },
        messageId: POST_ID,
        messageBlocks: blocks,
      });

      const patch: ServerCall = calls.find((call: ServerCall) => {
        return call.method === "PUT";
      })!;
      const context: JSONObject = contextOfFirstButton(
        patch.args.data as JSONObject,
      );

      // Mattermost names no team for a press in a direct message.
      expect(
        isSignedFor(context, { teamId: "", channelId: directChannelId }),
      ).toBe(true);
      expect(
        isSignedFor(context, { teamId: TEAM_ID, channelId: PUBLIC_CHANNEL_ID }),
      ).toBe(false);
    });

    test("an edit whose channel cannot be read is signed for the default team, and still made", async () => {
      on("PUT", `/api/v4/posts/${POST_ID}/patch`, ok({ id: POST_ID }));
      on(
        "GET",
        `/api/v4/channels/${PUBLIC_CHANNEL_ID}`,
        refused(503, "api.server.unavailable", "Unavailable"),
      );

      await MattermostUtil.updateMessage({
        authToken: AUTH_TOKEN,
        projectId: ObjectID.generate(),
        location: { channelId: PUBLIC_CHANNEL_ID },
        messageId: POST_ID,
        messageBlocks: blocks,
      });

      const patch: ServerCall = calls.find((call: ServerCall) => {
        return call.method === "PUT";
      })!;

      expect(
        isSignedFor(contextOfFirstButton(patch.args.data as JSONObject), {
          teamId: TEAM_ID,
        }),
      ).toBe(true);
    });

    test("a form opens signed for the team the press that opened it came from", async () => {
      on("POST", "/api/v4/actions/dialogs/open", ok({ status: "OK" }));

      await MattermostUtil.showModalToUser({
        authToken: AUTH_TOKEN,
        triggerId: "trigger-123",
        teamId: OTHER_TEAM_ID,
        modalBlock: {
          _type: "WorkspaceModalBlock",
          title: "Add Note",
          actionId: SlackActionType.SubmitIncidentNote,
          actionValue: "5a1d8e1c-6b2f-4e36-9c1e-0f2a3b4c5d6e",
          submitButtonTitle: "Submit",
          cancelButtonTitle: "Cancel",
          blocks: [],
        },
      });

      const state: unknown = (
        (calls[0]!.args.data as JSONObject)["dialog"] as JSONObject
      )["state"];

      expect(
        MattermostActionContext.readDialogState({
          state: state,
          teamId: OTHER_TEAM_ID,
        }),
      ).toMatchObject({ teamId: OTHER_TEAM_ID });
      expect(
        MattermostActionContext.readDialogState({
          state: state,
          teamId: TEAM_ID,
        }),
      ).toBeNull();
    });

    test("one name in two teams is two channels to create; in one team, one", () => {
      expect(
        MattermostUtil.isSameChannelToCreate(
          { channelName: "inc-42", teamId: TEAM_ID },
          { channelName: "INC 42", teamId: TEAM_ID },
        ),
      ).toBe(true);
      expect(
        MattermostUtil.isSameChannelToCreate(
          { channelName: "inc-42", teamId: TEAM_ID },
          { channelName: "inc-42", teamId: OTHER_TEAM_ID },
        ),
      ).toBe(false);
      expect(
        MattermostUtil.isSameChannelToCreate(
          { channelName: "inc-42" },
          { channelName: "inc-42", teamId: "" },
        ),
      ).toBe(true);
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
