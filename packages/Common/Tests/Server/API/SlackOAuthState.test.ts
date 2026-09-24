import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import crypto from "crypto";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { AppApiClientUrl } from "../../../Server/EnvironmentConfig";
import SlackAppManifest from "../../../Server/Utils/Workspace/Slack/app-manifest.json";
import {
  CacheEntry,
  cookieHeader,
  httpGet,
  makeUnsignedJwt,
  ProbeResponse,
  queryOf,
  RunningApp,
  startApp,
  TEST_MEMBER_OF_HEADER,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";

/*
 * The Slack connect callbacks write a project's Slack binding (install) and
 * link a Slack account to a OneUptime user (sign-in). These tests drive the
 * real routes over HTTP and pin that both callbacks trust only a single-use,
 * browser-bound state issued to an authorised member, and never the project
 * and user ids in the redirect path, which must agree with the state.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    SlackAppClientId: "1234567890.0987654321",
    SlackAppClientSecret: "slack-client-secret",
  };
});

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
    },
  };
});

const INSTALL_START: string = "/api/slack/install-url";
const SIGN_IN_START: string = "/api/slack/sign-in-url";

const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;

// What the in-memory GlobalCache has recorded (see createInMemoryGlobalCache).
const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

const SLACK_TEAM_ID: string = "T0123ABC456";

type Browser = Record<string, string>;

function withQuery(path: string, query: Record<string, string>): string {
  return `${path}?${new URLSearchParams(query).toString()}`;
}

describe("Slack OAuth state", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;
  let postSpy: jest.SpyInstance;

  const findProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.findOneBy as unknown as jest.Mock;
  const refreshProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.refreshAuthToken as unknown as jest.Mock;
  const refreshUserAuth: jest.Mock =
    WorkspaceUserAuthTokenService.refreshAuthToken as unknown as jest.Mock;

  // Loading the API pulls in a large module graph; give it its own budget.
  beforeAll(async () => {
    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;

    app = await startApp([new SlackAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockCacheStore.clear();
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    findProjectAuth.mockImplementation(async () => {
      return {
        workspaceProjectId: SLACK_TEAM_ID,
        miscData: { teamName: "Acme" },
      };
    });
    refreshProjectAuth.mockImplementation(async () => {
      return undefined;
    });
    refreshUserAuth.mockImplementation(async () => {
      return undefined;
    });

    // No test may reach Slack unless it stubs the call itself.
    postSpy = jest.spyOn(API, "post").mockImplementation(async () => {
      throw new Error("Unexpected API.post");
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function signedInHeaders(options?: {
    permissions?: Array<Permission> | undefined;
    memberOf?: ObjectID | undefined;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      [TEST_USER_HEADER]: userId.toString(),
      tenantid: projectId.toString(),
      [TEST_PERMISSIONS_HEADER]: (
        options?.permissions || [Permission.ProjectAdmin]
      ).join(","),
    };

    if (options?.memberOf) {
      headers[TEST_MEMBER_OF_HEADER] = options.memberOf.toString();
    }

    return headers;
  }

  function get(
    path: string,
    headers?: Record<string, string>,
  ): Promise<ProbeResponse> {
    return httpGet({ port: app.port, path, headers });
  }

  function installCallbackPath(data?: {
    projectId?: ObjectID;
    userId?: ObjectID;
  }): string {
    return `/api/slack/auth/${(data?.projectId || projectId).toString()}/${(
      data?.userId || userId
    ).toString()}`;
  }

  function signInCallbackPath(data?: {
    projectId?: ObjectID;
    userId?: ObjectID;
  }): string {
    return `${installCallbackPath(data)}/user`;
  }

  function callback(
    path: string,
    query: Record<string, string>,
    browser?: Browser,
  ): Promise<ProbeResponse> {
    return get(
      withQuery(path, query),
      browser && Object.keys(browser).length > 0
        ? { cookie: cookieHeader(browser) }
        : {},
    );
  }

  async function startFlow(
    path: string,
    options?: { permissions?: Array<Permission> | undefined },
  ): Promise<{ state: string; url: string; browser: Browser }> {
    const response: ProbeResponse = await get(
      path,
      signedInHeaders({ permissions: options?.permissions }),
    );

    expect(response.status).toBe(200);

    const url: string = (response.body as JSONObject)[
      "authorizationUrl"
    ] as string;

    return {
      state: queryOf(url).get("state")!,
      url,
      browser: { [COOKIE_NAME]: response.setCookies[COOKIE_NAME]! },
    };
  }

  function stubInstallTokenExchange(): void {
    postSpy.mockImplementation(async () => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          ok: true,
          access_token: "xoxb-bot-token",
          bot_user_id: "UBOT",
          team: { id: SLACK_TEAM_ID, name: "Acme" },
          authed_user: { id: "U123", access_token: "xoxp-user-token" },
        },
        {},
      ) as any;
    });
  }

  function stubSignInTokenExchange(teamId: string = SLACK_TEAM_ID): void {
    postSpy.mockImplementation(async () => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          ok: true,
          access_token: "xoxp-user-token",
          id_token: makeUnsignedJwt({
            "https://slack.com/team_id": teamId,
            "https://slack.com/user_id": "U123",
          }),
        },
        {},
      ) as any;
    });
  }

  function expectNothingWritten(): void {
    expect(refreshProjectAuth).not.toHaveBeenCalled();
    expect(refreshUserAuth).not.toHaveBeenCalled();
  }

  describe("GET /slack/install-url", () => {
    test("refuses an anonymous caller and issues no state", async () => {
      const response: ProbeResponse = await get(INSTALL_START, {
        tenantid: projectId.toString(),
      });

      expect(response.status).toBe(401);
      expect(mockCacheStore.size).toBe(0);
    });

    test("refuses a signed-in user who is not a member of the project", async () => {
      const response: ProbeResponse = await get(
        INSTALL_START,
        signedInHeaders({ memberOf: ObjectID.generate() }),
      );

      // NotAuthorizedException is answered with 422 throughout the API.
      expect(response.status).toBe(422);
      expect(mockCacheStore.size).toBe(0);
    });

    test("refuses a read-only member", async () => {
      const response: ProbeResponse = await get(
        INSTALL_START,
        signedInHeaders({ permissions: [Permission.Viewer] }),
      );

      expect(response.status).toBe(422);
      expect((response.body as JSONObject)["message"]).toBe(
        "You do not have permission to connect this project to Slack.",
      );
      expect(mockCacheStore.size).toBe(0);
    });

    test("returns the Slack install URL with an opaque state", async () => {
      const { state, url, browser } = await startFlow(INSTALL_START);

      expect(url.startsWith("https://slack.com/oauth/v2/authorize?")).toBe(
        true,
      );

      const query: URLSearchParams = queryOf(url);
      const scopes: JSONObject = (
        (SlackAppManifest as unknown as JSONObject)[
          "oauth_config"
        ] as JSONObject
      )["scopes"] as JSONObject;

      expect(query.get("client_id")).toBe("1234567890.0987654321");
      expect(query.get("scope")).toBe(
        (scopes["bot"] as Array<string>).join(","),
      );
      expect(query.get("user_scope")).toBe(
        (scopes["user"] as Array<string>).join(","),
      );
      expect(query.get("redirect_uri")).toBe(
        `${AppApiClientUrl.toString()}/slack/auth/${projectId.toString()}/${userId.toString()}`,
      );
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(state).not.toContain(projectId.toString());
      expect(browser[COOKIE_NAME]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
  });

  describe("GET /slack/auth/:projectId/:userId (install callback)", () => {
    test("refuses a callback with no state, however plausible its path", async () => {
      const response: ProbeResponse = await callback(installCallbackPath(), {
        code: "slack-code",
      });

      expect(response.status).toBe(400);
      expect((response.body as JSONObject)["message"]).toBe(
        WorkspaceOAuthState.INVALID_STATE_MESSAGE,
      );
      expect(postSpy).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("refuses a state OneUptime never issued", async () => {
      const { browser } = await startFlow(INSTALL_START);

      const response: ProbeResponse = await callback(
        installCallbackPath(),
        {
          code: "slack-code",
          state: crypto.randomBytes(32).toString("base64url"),
        },
        browser,
      );

      expect(response.status).toBe(400);
      expect(postSpy).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("installs into the project and user the state was issued for", async () => {
      const { state, browser } = await startFlow(INSTALL_START);
      stubInstallTokenExchange();

      const response: ProbeResponse = await callback(
        installCallbackPath(),
        { code: "slack-code", state },
        browser,
      );

      expect(response.status).toBe(302);
      expect(response.location).toContain(
        `/${projectId.toString()}/settings/slack-integration`,
      );

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect((postSpy.mock.calls[0]![0] as any).data).toMatchObject({
        code: "slack-code",
        redirect_uri: `${AppApiClientUrl.toString()}/slack/auth/${projectId.toString()}/${userId.toString()}`,
      });

      expect(refreshProjectAuth).toHaveBeenCalledTimes(1);
      const projectWrite: JSONObject = refreshProjectAuth.mock
        .calls[0]![0] as JSONObject;
      expect((projectWrite["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect(projectWrite["workspaceType"]).toBe(WorkspaceType.Slack);
      expect(projectWrite["workspaceProjectId"]).toBe(SLACK_TEAM_ID);

      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
      const userWrite: JSONObject = refreshUserAuth.mock
        .calls[0]![0] as JSONObject;
      expect((userWrite["userId"] as ObjectID).toString()).toBe(
        userId.toString(),
      );
    });

    test("refuses a path naming a different project from the state", async () => {
      const { state, browser } = await startFlow(INSTALL_START);
      stubInstallTokenExchange();

      const response: ProbeResponse = await callback(
        installCallbackPath({ projectId: ObjectID.generate() }),
        { code: "slack-code", state },
        browser,
      );

      expect(response.status).toBe(400);
      expect(postSpy).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("refuses a path naming a different user from the state", async () => {
      const { state, browser } = await startFlow(INSTALL_START);
      stubInstallTokenExchange();

      const response: ProbeResponse = await callback(
        installCallbackPath({ userId: ObjectID.generate() }),
        { code: "slack-code", state },
        browser,
      );

      expect(response.status).toBe(400);
      expectNothingWritten();
    });

    test("refuses a replayed state", async () => {
      const { state, browser } = await startFlow(INSTALL_START);
      stubInstallTokenExchange();

      await callback(
        installCallbackPath(),
        { code: "slack-code", state },
        browser,
      );

      const replay: ProbeResponse = await callback(
        installCallbackPath(),
        { code: "slack-code", state },
        browser,
      );

      expect(replay.status).toBe(400);
      expect(refreshProjectAuth).toHaveBeenCalledTimes(1);
    });

    test("refuses an expired state", async () => {
      const { state, browser } = await startFlow(INSTALL_START);
      stubInstallTokenExchange();

      const realNow: number = Date.now();
      jest
        .spyOn(Date, "now")
        .mockReturnValue(
          realNow + (WorkspaceOAuthState.EXPIRES_IN_SECONDS + 1) * 1000,
        );

      const response: ProbeResponse = await callback(
        installCallbackPath(),
        { code: "slack-code", state },
        browser,
      );

      expect(response.status).toBe(400);
      expectNothingWritten();
    });

    test("refuses an install completed in a browser that did not start it", async () => {
      // e.g. the install link was forwarded to another workspace's admin.
      const { state } = await startFlow(INSTALL_START);
      stubInstallTokenExchange();

      const response: ProbeResponse = await callback(installCallbackPath(), {
        code: "slack-code",
        state,
      });

      expect(response.status).toBe(400);
      expect(postSpy).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("refuses a sign-in state", async () => {
      const { state, browser } = await startFlow(SIGN_IN_START);
      stubInstallTokenExchange();

      const response: ProbeResponse = await callback(
        installCallbackPath(),
        { code: "slack-code", state },
        browser,
      );

      expect(response.status).toBe(400);
      expectNothingWritten();
    });

    test("reports a Slack error on the project that started the flow", async () => {
      const { state, browser } = await startFlow(INSTALL_START);

      const response: ProbeResponse = await callback(
        installCallbackPath(),
        { error: "access_denied", state },
        browser,
      );

      expect(response.status).toBe(302);
      expect(response.location).toContain(
        `/${projectId.toString()}/settings/slack-integration`,
      );
      expect(response.location).toContain("error=access_denied");
      expectNothingWritten();
    });
  });

  describe("GET /slack/sign-in-url and /slack/auth/:projectId/:userId/user", () => {
    test("refuses an anonymous caller", async () => {
      const response: ProbeResponse = await get(SIGN_IN_START, {
        tenantid: projectId.toString(),
      });

      expect(response.status).toBe(401);
      expect(mockCacheStore.size).toBe(0);
    });

    test("lets any member sign in, with an opaque state", async () => {
      const { state, url } = await startFlow(SIGN_IN_START, {
        permissions: [Permission.Viewer],
      });

      expect(
        url.startsWith("https://slack.com/openid/connect/authorize?"),
      ).toBe(true);
      expect(queryOf(url).get("scope")).toBe("openid profile email");
      expect(queryOf(url).get("redirect_uri")).toBe(
        `${AppApiClientUrl.toString()}/slack/auth/${projectId.toString()}/${userId.toString()}/user`,
      );
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    test("refuses a callback with no state", async () => {
      const response: ProbeResponse = await callback(signInCallbackPath(), {
        code: "slack-code",
      });

      expect(response.status).toBe(400);
      expect(postSpy).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("links the Slack user to the OneUptime user the state was issued for", async () => {
      const { state, browser } = await startFlow(SIGN_IN_START);
      stubSignInTokenExchange();

      const response: ProbeResponse = await callback(
        signInCallbackPath(),
        { code: "slack-code", state },
        browser,
      );

      expect(response.status).toBe(302);
      expect(response.location).toContain(
        `/${projectId.toString()}/settings/slack-integration`,
      );
      expect(response.location).not.toContain("error=");

      expect((postSpy.mock.calls[0]![0] as any).data).toMatchObject({
        redirect_uri: `${AppApiClientUrl.toString()}/slack/auth/${projectId.toString()}/${userId.toString()}/user`,
      });

      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
      const userWrite: JSONObject = refreshUserAuth.mock
        .calls[0]![0] as JSONObject;
      expect((userWrite["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((userWrite["userId"] as ObjectID).toString()).toBe(
        userId.toString(),
      );
      expect(userWrite["workspaceUserId"]).toBe("U123");
      expect(refreshProjectAuth).not.toHaveBeenCalled();
    });

    test("refuses a path naming a different user from the state", async () => {
      const { state, browser } = await startFlow(SIGN_IN_START);
      stubSignInTokenExchange();

      const response: ProbeResponse = await callback(
        signInCallbackPath({ userId: ObjectID.generate() }),
        { code: "slack-code", state },
        browser,
      );

      expect(response.status).toBe(400);
      expect(postSpy).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("refuses a replayed state", async () => {
      const { state, browser } = await startFlow(SIGN_IN_START);
      stubSignInTokenExchange();

      await callback(
        signInCallbackPath(),
        { code: "slack-code", state },
        browser,
      );

      const replay: ProbeResponse = await callback(
        signInCallbackPath(),
        { code: "slack-code", state },
        browser,
      );

      expect(replay.status).toBe(400);
      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
    });

    test("refuses a sign-in completed in a browser that did not start it", async () => {
      const { state } = await startFlow(SIGN_IN_START);
      stubSignInTokenExchange();

      const response: ProbeResponse = await callback(signInCallbackPath(), {
        code: "slack-code",
        state,
      });

      expect(response.status).toBe(400);
      expectNothingWritten();
    });

    test("refuses an install state", async () => {
      const { state, browser } = await startFlow(INSTALL_START);
      stubSignInTokenExchange();

      const response: ProbeResponse = await callback(
        signInCallbackPath(),
        { code: "slack-code", state },
        browser,
      );

      expect(response.status).toBe(400);
      expectNothingWritten();
    });

    test("still refuses a Slack account from a different workspace", async () => {
      const { state, browser } = await startFlow(SIGN_IN_START);
      stubSignInTokenExchange("T9999OTHER");

      const response: ProbeResponse = await callback(
        signInCallbackPath(),
        { code: "slack-code", state },
        browser,
      );

      expect(response.status).toBe(302);
      expect(response.location).toContain("error=");
      expectNothingWritten();
    });
  });
});
