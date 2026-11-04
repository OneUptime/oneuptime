import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { JSONObject } from "../../../Types/JSON";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ConnectCallbackError,
  ConnectProvider,
} from "../../../Types/Workspace/ConnectCallback";
import { WorkspacePayloadMarkdown } from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import MattermostUtil, {
  MattermostRequestError,
} from "../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostConnection from "../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import MattermostActions from "../../../Server/Utils/Workspace/Mattermost/MattermostActions";
import TestSendAccess from "../../../Server/API/TestSendAccess";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { DashboardClientUrl } from "../../../Server/EnvironmentConfig";
import {
  CacheEntry,
  cookieHeader,
  httpRequest,
  ProbeResponse,
  queryOf,
  RunningApp,
  startApp,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";

/*
 * The Mattermost routes, driven over HTTP: connecting a project to a team of
 * a Mattermost server as a bot account, listing its channels, and a
 * member connecting their own Mattermost account with the link the bot
 * sends them - one-use, bound to the browser that asked, and spent only by
 * the member who asked, while they are still in the project and the project
 * is still connected to the team the link was sent from. Faked: the session
 * middleware, Redis, the membership read, the database services and every
 * call to Mattermost.
 */

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: (...args: Array<any>) => {
        return (
          jest.requireActual("./WorkspaceOAuthTestHelpers") as any
        ).fakeGetUserMiddleware(...args);
      },
    },
  };
});

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("./WorkspaceOAuthTestHelpers") as any
    ).createInMemoryGlobalCache(),
  };
});

jest.mock("../../../Server/Services/WorkspaceProjectAuthTokenService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      getProjectAuth: jest.fn(),
      refreshAuthToken: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/WorkspaceUserAuthTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshAuthToken: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      }),
      findOneById: jest.fn(async () => {
        return { name: "Production" };
      }),
    },
  };
});

const SERVER: string = "https://chat.example.com";
const ACCESS_TOKEN: string = "abcdefghijklmnopqrstuvwxyz";
const TEAM_ID: string = "t".repeat(26);
const OTHER_TEAM_ID: string = "o".repeat(26);
const BOT_ID: string = "b".repeat(26);
const ALICE_ID: string = "a".repeat(26);

const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;

const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

/*
 * The counter a member's sign-in links are counted with, as Redis keeps it
 * (GlobalCache.incrementIfBelow): the in-memory cache has none of its own.
 */
const mockCounters: Map<string, number> = new Map<string, number>();

(GlobalCache as any).incrementIfBelow = async (
  namespace: string,
  key: string,
  options: { limit: number },
): Promise<number | null> => {
  const counterKey: string = `${namespace}-${key}`;
  const current: number = mockCounters.get(counterKey) || 0;

  if (current >= options.limit) {
    return null;
  }

  mockCounters.set(counterKey, current + 1);

  return current + 1;
};

describe("MattermostAPI", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;

  const getProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.getProjectAuth as unknown as jest.Mock;
  const findProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.findOneBy as unknown as jest.Mock;
  const refreshProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.refreshAuthToken as unknown as jest.Mock;
  const refreshUserAuth: jest.Mock =
    WorkspaceUserAuthTokenService.refreshAuthToken as unknown as jest.Mock;

  let getBot: jest.SpyInstance;
  let getTeams: jest.SpyInstance;
  let findByUsername: jest.SpyInstance;
  let findByEmail: jest.SpyInstance;
  let sendDirectMessage: jest.SpyInstance;

  // Whether whoever started a flow is still a member when they come back.
  let isStillMember: boolean = true;

  const authToken: string = MattermostConnection.toAuthToken({
    serverUrl: SERVER,
    accessToken: ACCESS_TOKEN,
    teamId: TEAM_ID,
    botUserId: BOT_ID,
  });

  beforeAll(async () => {
    const MattermostAPI: any = (
      await import("../../../Server/API/MattermostAPI")
    ).default;

    app = await startApp([new MattermostAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockCacheStore.clear();
    mockCounters.clear();
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    isStillMember = true;

    getProjectAuth.mockResolvedValue({
      authToken: authToken,
      workspaceProjectId: TEAM_ID,
      miscData: { teamId: TEAM_ID },
    });
    findProjectAuth.mockResolvedValue({ workspaceProjectId: TEAM_ID });
    refreshProjectAuth.mockResolvedValue(undefined);
    refreshUserAuth.mockResolvedValue(undefined);

    getBot = jest.spyOn(MattermostUtil, "getBotAccount").mockResolvedValue({
      id: BOT_ID,
      username: "oneuptime",
      displayName: "OneUptime",
      isBot: true,
      isGuest: false,
    });
    getTeams = jest
      .spyOn(MattermostUtil, "getTeamsOfBot")
      .mockResolvedValue([
        { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
      ]);
    findByUsername = jest
      .spyOn(MattermostUtil, "findUserByUsername")
      .mockResolvedValue({
        id: ALICE_ID,
        username: "alice",
        displayName: "Alice",
        isBot: false,
        isGuest: false,
      });
    findByEmail = jest
      .spyOn(MattermostUtil, "findUserByEmail")
      .mockResolvedValue(null);
    sendDirectMessage = jest
      .spyOn(MattermostUtil, "sendDirectMessageToUser")
      .mockResolvedValue(undefined);

    jest.spyOn(UserService, "findOneById").mockImplementation(async () => {
      return {
        name: "Alice Admin",
        email: "alice@example.com",
        isMasterAdmin: false,
      } as any;
    });

    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(
        async (data: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          if (!isStillMember) {
            throw new NotAuthorizedException(
              WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
            );
          }

          return {
            userId: data.userId,
            tenantId: data.projectId,
          } as DatabaseCommonInteractionProps;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function headers(
    permissions: Array<Permission> = [Permission.ProjectAdmin],
    browser: Record<string, string> = {},
  ): Record<string, string> {
    const sent: Record<string, string> = {
      [TEST_USER_HEADER]: userId.toString(),
      tenantid: projectId.toString(),
      [TEST_PERMISSIONS_HEADER]: permissions.join(","),
    };

    if (Object.keys(browser).length > 0) {
      sent["cookie"] = cookieHeader(browser);
    }

    return sent;
  }

  function call(
    method: string,
    path: string,
    data: {
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<ProbeResponse> {
    return httpRequest({
      port: app.port,
      method: method,
      path: `/api${path}`,
      headers: data.headers ?? headers(),
      body: data.body,
      timeoutMs: 10000,
    });
  }

  function message(of: ProbeResponse): string {
    return String((of.body as JSONObject)?.["message"] || "");
  }

  describe("POST /mattermost/teams", () => {
    test("names the bot account and lists its teams, keeping nothing", async () => {
      const response: ProbeResponse = await call("POST", "/mattermost/teams", {
        body: { serverUrl: "chat.example.com/", accessToken: ACCESS_TOKEN },
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        bot: { username: "oneuptime", displayName: "OneUptime", isBot: true },
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
        ],
      });
      expect(getBot).toHaveBeenCalledWith({
        serverUrl: SERVER,
        accessToken: ACCESS_TOKEN,
      });
      expect(refreshProjectAuth).not.toHaveBeenCalled();
    });

    test("is refused to a Viewer, who may not connect the project", async () => {
      const response: ProbeResponse = await call("POST", "/mattermost/teams", {
        body: { serverUrl: SERVER, accessToken: ACCESS_TOKEN },
        headers: headers([Permission.Viewer]),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(message(response)).toContain(
        "You do not have permission to connect this project to Mattermost",
      );
      expect(getBot).not.toHaveBeenCalled();
    });

    test("is refused to somebody who is not signed in", async () => {
      const response: ProbeResponse = await call("POST", "/mattermost/teams", {
        body: { serverUrl: SERVER, accessToken: ACCESS_TOKEN },
        headers: { tenantid: projectId.toString() },
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(getBot).not.toHaveBeenCalled();
    });

    test("a server address that is not one is refused before anything is called", async () => {
      const response: ProbeResponse = await call("POST", "/mattermost/teams", {
        body: {
          serverUrl: "ftp://chat.example.com",
          accessToken: ACCESS_TOKEN,
        },
      });

      expect(response.status).toBe(400);
      expect(message(response)).toContain(
        "must start with https:// or http://",
      );
      expect(getBot).not.toHaveBeenCalled();
    });

    test("a token the server does not take is said so", async () => {
      getBot.mockRejectedValue(
        new MattermostRequestError({
          message: "Error from Mattermost: Invalid or expired session",
          statusCode: 401,
          errorId: "api.context.session_expired.app_error",
        }),
      );

      const response: ProbeResponse = await call("POST", "/mattermost/teams", {
        body: { serverUrl: SERVER, accessToken: ACCESS_TOKEN },
      });

      expect(response.status).toBe(400);
      expect(message(response)).toContain(
        "Mattermost did not accept the access token",
      );
    });

    test("a server OneUptime cannot reach is said so", async () => {
      getBot.mockRejectedValue(
        new Error("getaddrinfo ENOTFOUND chat.example.com"),
      );

      const response: ProbeResponse = await call("POST", "/mattermost/teams", {
        body: { serverUrl: SERVER, accessToken: ACCESS_TOKEN },
      });

      expect(response.status).toBe(400);
      expect(message(response)).toContain(
        "OneUptime could not reach the Mattermost server",
      );
    });
  });

  describe("POST /mattermost/connect", () => {
    test("connects the project to the bot's only team, the token kept server-side only", async () => {
      const response: ProbeResponse = await call(
        "POST",
        "/mattermost/connect",
        {
          body: { serverUrl: SERVER, accessToken: ACCESS_TOKEN },
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        teamDisplayName: "Engineering",
        botUsername: "oneuptime",
      });

      expect(refreshProjectAuth).toHaveBeenCalledTimes(1);

      const written: JSONObject = refreshProjectAuth.mock.calls[0][0];

      expect(written["projectId"]).toEqual(projectId);
      expect(written["workspaceType"]).toBe(WorkspaceType.Mattermost);
      expect(written["workspaceProjectId"]).toBe(TEAM_ID);
      expect(written["miscData"]).toEqual({
        serverUrl: SERVER,
        teamId: TEAM_ID,
        teamName: "engineering",
        teamDisplayName: "Engineering",
        botUserId: BOT_ID,
        botUsername: "oneuptime",
      });
      expect(JSON.stringify(written["miscData"])).not.toContain(ACCESS_TOKEN);
      expect(
        MattermostConnection.fromAuthToken(written["authToken"] as string),
      ).toEqual({
        serverUrl: SERVER,
        accessToken: ACCESS_TOKEN,
        teamId: TEAM_ID,
        botUserId: BOT_ID,
      });
    });

    test("a bot in several teams connects only to the one chosen", async () => {
      getTeams.mockResolvedValue([
        { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
        { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
      ]);

      const unchosen: ProbeResponse = await call(
        "POST",
        "/mattermost/connect",
        {
          body: { serverUrl: SERVER, accessToken: ACCESS_TOKEN },
        },
      );

      expect(unchosen.status).toBe(400);
      expect(message(unchosen)).toContain("Choose the team");
      expect(refreshProjectAuth).not.toHaveBeenCalled();

      const chosen: ProbeResponse = await call("POST", "/mattermost/connect", {
        body: {
          serverUrl: SERVER,
          accessToken: ACCESS_TOKEN,
          teamId: OTHER_TEAM_ID,
        },
      });

      expect(chosen.status).toBe(200);
      expect(refreshProjectAuth.mock.calls[0][0]["workspaceProjectId"]).toBe(
        OTHER_TEAM_ID,
      );
    });

    test("a team the bot is not in is refused, whatever the form says", async () => {
      const response: ProbeResponse = await call(
        "POST",
        "/mattermost/connect",
        {
          body: {
            serverUrl: SERVER,
            accessToken: ACCESS_TOKEN,
            teamId: OTHER_TEAM_ID,
          },
        },
      );

      expect(response.status).toBe(400);
      expect(message(response)).toContain("is not a member of that team");
      expect(refreshProjectAuth).not.toHaveBeenCalled();
    });

    test("a bot in no team is told to be added to one", async () => {
      getTeams.mockResolvedValue([]);

      const response: ProbeResponse = await call(
        "POST",
        "/mattermost/connect",
        {
          body: { serverUrl: SERVER, accessToken: ACCESS_TOKEN },
        },
      );

      expect(response.status).toBe(400);
      expect(message(response)).toContain(
        "The bot account @oneuptime is not a member of any team",
      );
    });

    test("is refused to a Viewer", async () => {
      const response: ProbeResponse = await call(
        "POST",
        "/mattermost/connect",
        {
          body: { serverUrl: SERVER, accessToken: ACCESS_TOKEN },
          headers: headers([Permission.Viewer]),
        },
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(refreshProjectAuth).not.toHaveBeenCalled();
    });

    test("a project connected to another team keeps it: the refusal is passed on", async () => {
      refreshProjectAuth.mockRejectedValue(
        new (
          jest.requireActual("../../../Types/Exception/BadDataException") as any
        ).default(
          "This OneUptime project is already connected to a different Mattermost workspace.",
        ),
      );

      const response: ProbeResponse = await call(
        "POST",
        "/mattermost/connect",
        {
          body: { serverUrl: SERVER, accessToken: ACCESS_TOKEN },
        },
      );

      expect(response.status).toBe(400);
      expect(message(response)).toContain("already connected to a different");
    });
  });

  describe("GET /mattermost/channels", () => {
    test("lists the channels the bot can post in, by name", async () => {
      jest.spyOn(MattermostUtil, "listChannels").mockResolvedValue([
        {
          id: "c".repeat(26),
          name: "town-square",
          displayName: "Town Square",
          type: "O",
          workspaceType: WorkspaceType.Mattermost,
        },
        {
          id: "p".repeat(26),
          name: "incidents",
          displayName: "Incidents",
          type: "P",
          workspaceType: WorkspaceType.Mattermost,
        },
      ]);

      const response: ProbeResponse = await call("GET", "/mattermost/channels");

      expect(response.status).toBe(200);
      expect((response.body as JSONObject)["channels"]).toEqual([
        {
          id: "p".repeat(26),
          name: "incidents",
          displayName: "Incidents",
          isPrivate: true,
        },
        {
          id: "c".repeat(26),
          name: "town-square",
          displayName: "Town Square",
          isPrivate: false,
        },
      ]);
    });

    test("a project not connected is told how to connect it", async () => {
      getProjectAuth.mockResolvedValue(null);

      const response: ProbeResponse = await call("GET", "/mattermost/channels");

      expect(response.status).toBe(400);
      expect(message(response)).toContain(
        "Mattermost is not connected to this project",
      );
    });
  });

  describe("POST /mattermost/channels/test", () => {
    test("sends a test notification to the channel, as a rule would", async () => {
      jest.spyOn(TestSendAccess, "assertMaySendTest").mockResolvedValue({
        projectId: projectId,
        userId: userId,
      } as never);
      const send: jest.SpyInstance = jest
        .spyOn(
          WorkspaceNotificationRuleService,
          "sendTestNotificationToDestination",
        )
        .mockResolvedValue({} as never);

      const response: ProbeResponse = await call(
        "POST",
        "/mattermost/channels/test",
        { body: { channelId: "c".repeat(26) } },
      );

      expect(response.status).toBe(200);
      expect(send).toHaveBeenCalledWith({
        projectId: projectId,
        workspaceType: WorkspaceType.Mattermost,
        testByUserId: userId,
        channelId: "c".repeat(26),
      });
    });
  });

  describe("connecting a member's own Mattermost account", () => {
    async function sendLink(
      data: {
        username?: string | undefined;
        browser?: Record<string, string> | undefined;
        from?: string | undefined;
      } = {},
    ): Promise<ProbeResponse> {
      return await call(
        "POST",
        `/mattermost/sign-in-link${data.from ? `?from=${data.from}` : ""}`,
        {
          body: data.username ? { username: data.username } : {},
          headers: headers([Permission.ProjectMember], data.browser || {}),
        },
      );
    }

    // The link the bot sent, as the account reads it in its direct message.
    function sentLink(): string {
      const blocks: Array<WorkspacePayloadMarkdown> =
        sendDirectMessage.mock.calls[sendDirectMessage.mock.calls.length - 1][0]
          .messageBlocks;
      const found: RegExpMatchArray | null = blocks[0]!.text.match(
        /\]\((http[^)\s]+\/mattermost\/auth\/user\?state=[^)\s]+)\)/,
      );

      expect(found).not.toBeNull();

      return found![1]!;
    }

    function pathOf(link: string): string {
      const url: globalThis.URL = new globalThis.URL(link);
      return `${url.pathname.replace(/^.*?\/api/, "")}${url.search}`;
    }

    test("the bot sends the account of the username typed a one-use link", async () => {
      const response: ProbeResponse = await sendLink({ username: "@alice" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ username: "alice" });
      expect(findByUsername).toHaveBeenCalledWith({
        authToken: authToken,
        username: "@alice",
      });
      expect(sendDirectMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          authToken: authToken,
          workspaceUserId: ALICE_ID,
        }),
      );
      expect(response.setCookies[COOKIE_NAME]).toBeTruthy();
    });

    test("the direct message says who asked, in which project, and what to do if it was not them", async () => {
      await sendLink({ username: "alice" });

      const text: string =
        sendDirectMessage.mock.calls[0][0].messageBlocks[0].text;

      expect(text).toContain("Connect your Mattermost account to OneUptime");
      expect(text).toContain("Alice Admin (alice@example.com)");
      expect(text).toContain("in the project Production");
      expect(text).toContain("[Connect my account](");
      expect(text).toContain(
        "If you did not ask for this, ignore this message",
      );
    });

    test("without a username, the account with the member's email address gets the link", async () => {
      findByEmail.mockResolvedValue({
        id: ALICE_ID,
        username: "alice",
        displayName: "Alice",
        isBot: false,
        isGuest: false,
      });

      const response: ProbeResponse = await sendLink();

      expect(response.status).toBe(200);
      expect(findByEmail).toHaveBeenCalledWith({
        authToken: authToken,
        email: "alice@example.com",
      });
    });

    test("without a username and no account found by email, the member is asked for their username", async () => {
      const response: ProbeResponse = await sendLink();

      expect(response.status).toBe(400);
      expect(message(response)).toContain(
        "Enter your Mattermost username instead",
      );
      expect(sendDirectMessage).not.toHaveBeenCalled();
    });

    test("a username of nobody on the server is said so", async () => {
      findByUsername.mockResolvedValue(null);

      const response: ProbeResponse = await sendLink({ username: "nobody" });

      expect(response.status).toBe(400);
      expect(message(response)).toContain(
        "There is no Mattermost account with that username",
      );
    });

    test("a bot account is never connected to a person", async () => {
      findByUsername.mockResolvedValue({
        id: BOT_ID,
        username: "oneuptime",
        displayName: "",
        isBot: true,
        isGuest: false,
      });

      const response: ProbeResponse = await sendLink({ username: "oneuptime" });

      expect(response.status).toBe(400);
      expect(message(response)).toContain("That is a bot account");
      expect(sendDirectMessage).not.toHaveBeenCalled();
    });

    test("a project not connected to Mattermost sends nothing", async () => {
      getProjectAuth.mockResolvedValue(null);

      const response: ProbeResponse = await sendLink({ username: "alice" });

      expect(response.status).toBe(400);
      expect(sendDirectMessage).not.toHaveBeenCalled();
    });

    test("somebody not signed in sends nothing", async () => {
      const response: ProbeResponse = await call(
        "POST",
        "/mattermost/sign-in-link",
        {
          body: { username: "alice" },
          headers: { tenantid: projectId.toString() },
        },
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(sendDirectMessage).not.toHaveBeenCalled();
    });

    test("only a few links are sent to one member in a while", async () => {
      for (let attempt: number = 0; attempt < 5; attempt++) {
        expect((await sendLink({ username: "alice" })).status).toBe(200);
      }

      const sixth: ProbeResponse = await sendLink({ username: "alice" });

      expect(sixth.status).toBe(400);
      expect(message(sixth)).toContain("several Mattermost links");
      expect(sendDirectMessage).toHaveBeenCalledTimes(5);
    });

    test("the link, opened in the browser that asked, connects the account to the member who asked", async () => {
      const started: ProbeResponse = await sendLink({ username: "alice" });
      const browser: Record<string, string> = {
        [COOKIE_NAME]: started.setCookies[COOKIE_NAME]!,
      };

      const callback: ProbeResponse = await httpRequest({
        port: app.port,
        method: "GET",
        path: `/api${pathOf(sentLink())}`,
        headers: { cookie: cookieHeader(browser) },
        timeoutMs: 10000,
      });

      expect(callback.status).toBe(302);
      expect(callback.location).toBe(
        `${DashboardClientUrl.toString()}/${projectId.toString()}/settings/mattermost-integration`,
      );
      expect(refreshUserAuth).toHaveBeenCalledWith({
        projectId: projectId,
        userId: userId,
        workspaceType: WorkspaceType.Mattermost,
        authToken: "",
        workspaceUserId: ALICE_ID,
        miscData: { userId: ALICE_ID, username: "alice" },
      });
    });

    test("a link asked for from User Settings sends the browser back there", async () => {
      const started: ProbeResponse = await sendLink({
        username: "alice",
        from: "user-settings",
      });

      const callback: ProbeResponse = await httpRequest({
        port: app.port,
        method: "GET",
        path: `/api${pathOf(sentLink())}`,
        headers: {
          cookie: cookieHeader({
            [COOKIE_NAME]: started.setCookies[COOKIE_NAME]!,
          }),
        },
        timeoutMs: 10000,
      });

      expect(callback.location).toBe(
        `${DashboardClientUrl.toString()}/${projectId.toString()}/user-settings/mattermost-integration`,
      );
    });

    test("the link opened in another browser connects nothing", async () => {
      await sendLink({ username: "alice" });

      const callback: ProbeResponse = await httpRequest({
        port: app.port,
        method: "GET",
        path: `/api${pathOf(sentLink())}`,
        timeoutMs: 10000,
      });

      expect(callback.status).toBe(302);
      expect(queryOf(callback.location!).get("provider")).toBe(
        ConnectProvider.Mattermost,
      );
      expect(refreshUserAuth).not.toHaveBeenCalled();
    });

    test("the link works once", async () => {
      const started: ProbeResponse = await sendLink({ username: "alice" });
      const browser: string = cookieHeader({
        [COOKIE_NAME]: started.setCookies[COOKIE_NAME]!,
      });
      const path: string = `/api${pathOf(sentLink())}`;

      await httpRequest({
        port: app.port,
        method: "GET",
        path: path,
        headers: { cookie: browser },
        timeoutMs: 10000,
      });

      const replayed: ProbeResponse = await httpRequest({
        port: app.port,
        method: "GET",
        path: path,
        headers: { cookie: browser },
        timeoutMs: 10000,
      });

      expect(replayed.status).toBe(302);
      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
    });

    test("a member no longer in the project connects nothing", async () => {
      const started: ProbeResponse = await sendLink({ username: "alice" });

      isStillMember = false;

      const callback: ProbeResponse = await httpRequest({
        port: app.port,
        method: "GET",
        path: `/api${pathOf(sentLink())}`,
        headers: {
          cookie: cookieHeader({
            [COOKIE_NAME]: started.setCookies[COOKIE_NAME]!,
          }),
        },
        timeoutMs: 10000,
      });

      expect(queryOf(callback.location!).get("error")).toBe(
        ConnectCallbackError.NotAMember,
      );
      expect(refreshUserAuth).not.toHaveBeenCalled();
    });

    test("a project connected to another team since the link was sent connects nothing", async () => {
      const started: ProbeResponse = await sendLink({ username: "alice" });

      findProjectAuth.mockResolvedValue({ workspaceProjectId: OTHER_TEAM_ID });

      const callback: ProbeResponse = await httpRequest({
        port: app.port,
        method: "GET",
        path: `/api${pathOf(sentLink())}`,
        headers: {
          cookie: cookieHeader({
            [COOKIE_NAME]: started.setCookies[COOKIE_NAME]!,
          }),
        },
        timeoutMs: 10000,
      });

      expect(queryOf(callback.location!).get("error")).toBe(
        ConnectCallbackError.MattermostNotConnected,
      );
      expect(refreshUserAuth).not.toHaveBeenCalled();
    });

    test("a state never issued connects nothing", async () => {
      const callback: ProbeResponse = await httpRequest({
        port: app.port,
        method: "GET",
        path: `/api/mattermost/auth/user?state=${"x".repeat(43)}`,
        timeoutMs: 10000,
      });

      expect(callback.status).toBe(302);
      expect(refreshUserAuth).not.toHaveBeenCalled();
    });
  });

  describe("presses and forms from the Mattermost server", () => {
    test("a press is answered with what MattermostActions says, to the presser alone", async () => {
      const handle: jest.SpyInstance = jest
        .spyOn(MattermostActions, "handlePress")
        .mockResolvedValue({ ephemeral_text: "✅ Acknowledged." });

      const body: JSONObject = {
        user_id: ALICE_ID,
        team_id: TEAM_ID,
        context: {},
      };

      const response: ProbeResponse = await call(
        "POST",
        "/mattermost/interactive",
        {
          body: body,
          headers: {},
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ephemeral_text: "✅ Acknowledged." });
      expect(handle).toHaveBeenCalledWith(body);
    });

    test("a press that fails unexpectedly is still answered", async () => {
      jest
        .spyOn(MattermostActions, "handlePress")
        .mockRejectedValue(new Error("boom"));

      const response: ProbeResponse = await call(
        "POST",
        "/mattermost/interactive",
        {
          body: {},
          headers: {},
        },
      );

      expect(response.status).toBe(200);
      expect((response.body as JSONObject)["ephemeral_text"]).toContain(
        "could not do that just now",
      );
    });

    test("a form's submission is answered with what MattermostActions says", async () => {
      jest
        .spyOn(MattermostActions, "handleDialogSubmission")
        .mockResolvedValue({ errors: { note: "Type a note." } });

      const response: ProbeResponse = await call("POST", "/mattermost/dialog", {
        body: { type: "dialog_submission" },
        headers: {},
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ errors: { note: "Type a note." } });
    });
  });
});
