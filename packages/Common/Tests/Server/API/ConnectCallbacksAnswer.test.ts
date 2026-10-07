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
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ProjectService from "../../../Server/Services/ProjectService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { DashboardClientUrl } from "../../../Server/EnvironmentConfig";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  CacheEntry,
  cookieHeader,
  httpGet,
  makeUnsignedJwt,
  ProbeResponse,
  queryOf,
  RunningApp,
  startApp,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";

/*
 * EVERY CONNECT CALLBACK ANSWERS, ON THE PAGE ITS CONNECTION STARTED FROM,
 * WITHOUT WHAT FAILED.
 *
 * Connecting Slack (install, sign-in), Microsoft Teams (admin consent,
 * sign-in) or a GitHub App installation starts on a OneUptime page and ends
 * on a callback the provider sends the browser to. Whatever happens there -
 * the connection is made, the person may no longer make it, the provider says
 * no, a read or a write fails, something throws that is not even an Error -
 * the browser is sent back to the page it came from, and told what happened
 * with one of a fixed set of codes in `?error=`, which the page turns into
 * its own sentence. Never a request left without an answer (Express 4 does
 * not catch an async handler's rejection), never a bare JSON error page, and
 * never what the provider or a failed read said.
 *
 * When the callback cannot tell which project the connection was for - a
 * link that cannot be used - it sends the browser to the Dashboard's
 * connect-return page, which opens the provider's page in the project the
 * person has open.
 *
 * These drive the real routers over HTTP. Faked: the session middleware,
 * Redis, the membership read, and everything that writes or talks to Slack,
 * Microsoft or GitHub. Every request here gives up after a few seconds, so a
 * callback that never answers fails its test instead of hanging it.
 */

const TEAMS_CLIENT_ID: string = "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80";
const TENANT_ID: string = "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11";
const OTHER_TENANT_ID: string = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag({
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    SlackAppClientId: "1234567890.0987654321",
    SlackAppClientSecret: "slack-client-secret",
    MicrosoftTeamsAppClientId: "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80",
    MicrosoftTeamsAppClientSecret: "teams-client-secret",
    GitHubAppName: "oneuptime-test-app",
    GitHubAppClientId: "Iv1.github-client-id",
    GitHubAppClientSecret: "github-client-secret",
  });
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
      getProjectAuth: jest.fn(),
      refreshAuthToken: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/WorkspaceUserAuthTokenService", () => {
  return {
    __esModule: true,
    default: {
      getUserAuth: jest.fn(),
      refreshAuthToken: jest.fn(),
    },
  };
});

jest.mock(
  "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams",
  () => {
    return {
      __esModule: true,
      default: {
        refreshTeams: jest.fn(),
      },
    };
  },
);

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(),
      updateOneById: jest.fn(),
      findBy: jest.fn(),
      updateBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/CodeRepositoryService", () => {
  return {
    __esModule: true,
    default: {
      importReposFromInstallation: jest.fn(),
      deleteBy: jest.fn(),
      updateBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/CodeRepository/GitHub/GitHub", () => {
  return {
    __esModule: true,
    default: {
      assertUserControlsInstallation: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    },
  };
});

jest.mock(
  "../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookHandler",
  () => {
    return {
      __esModule: true,
      default: {
        handleEvent: jest.fn(),
      },
    };
  },
);

// Many answers below log what failed; the log is not under test.
jest.mock("../../../Server/Utils/Logger");

// No callback may take longer than this to answer.
const ANSWER_WITHIN_MS: number = 5000;

const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;

// What the in-memory GlobalCache has recorded (see createInMemoryGlobalCache).
const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

// Every code a callback may put in `?error=`; nothing else may appear there.
const ANSWER_CODES: ReadonlyArray<string> = [
  "link-invalid",
  "no-permission",
  "not-a-member",
  "plan-required",
  "cancelled",
  "not-configured",
  "could-not-finish",
  "slack-other-workspace",
  "slack-not-installed",
  "teams-other-tenant",
  "teams-no-teams",
  "github-no-installation",
  "github-no-authorization",
  "github-not-verified",
];

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

type Browser = Record<string, string>;

function withQuery(path: string, query: Record<string, string>): string {
  return `${path}?${new URLSearchParams(query).toString()}`;
}

// What a request rejected with when it is neither an Error nor an Exception.
const NOT_AN_ERROR: JSONObject = {
  code: "ECONNRESET",
  detail: "upstream-secret-detail",
};

describe("Every connect callback answers on the page it came from", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;
  let postSpy: jest.SpyInstance;
  let getSpy: jest.SpyInstance;

  // What the person who started a flow holds when the provider sends them back.
  let callbackMembership: Array<Permission> | null = null;

  const findSlackProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.findOneBy as unknown as jest.Mock;
  const getProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.getProjectAuth as unknown as jest.Mock;
  const refreshProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.refreshAuthToken as unknown as jest.Mock;
  const refreshUserAuth: jest.Mock =
    WorkspaceUserAuthTokenService.refreshAuthToken as unknown as jest.Mock;
  const getUserAuth: jest.Mock =
    WorkspaceUserAuthTokenService.getUserAuth as unknown as jest.Mock;
  const getCurrentPlan: jest.Mock =
    ProjectService.getCurrentPlan as unknown as jest.Mock;
  const bindInstallation: jest.Mock =
    ProjectService.updateOneById as unknown as jest.Mock;
  const importRepositories: jest.Mock =
    CodeRepositoryService.importReposFromInstallation as unknown as jest.Mock;
  const verifyInstallation: jest.Mock =
    GitHubUtil.assertUserControlsInstallation as unknown as jest.Mock;

  const savedPlanEnvironment: Record<string, string | undefined> = {};

  // Every `?error=` any callback answered with, checked against the codes.
  const answeredCodes: Set<string> = new Set<string>();

  // Loading the APIs pulls in a large module graph; give it its own budget.
  beforeAll(async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SUBSCRIPTION_PLAN_")) {
        savedPlanEnvironment[key] = process.env[key];
        delete process.env[key];
      }
    }

    Object.assign(process.env, PLAN_ENVIRONMENT);

    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;
    const MicrosoftTeamsAPI: any = (
      await import("../../../Server/API/MicrosoftTeamsAPI")
    ).default;
    const GitHubAPI: any = (await import("../../../Server/API/GitHubAPI"))
      .default;

    app = await startApp([
      new SlackAPI().getRouter(),
      new MicrosoftTeamsAPI().getRouter(),
      new GitHubAPI().getRouter(),
    ]);
  }, 600000);

  afterAll(async () => {
    await app.close();

    for (const key of Object.keys(PLAN_ENVIRONMENT)) {
      delete process.env[key];
    }

    for (const [key, value] of Object.entries(savedPlanEnvironment)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }

    // Every code any test saw is one a page knows.
    for (const code of answeredCodes) {
      expect(ANSWER_CODES).toContain(code);
    }
  });

  beforeEach(() => {
    mockCacheStore.clear();
    jest.clearAllMocks();
    setTestBillingEnabled(false);

    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    callbackMembership = [Permission.ProjectOwner];

    findSlackProjectAuth.mockImplementation(async () => {
      return {
        workspaceProjectId: "T0123ABC456",
        miscData: { teamName: "Acme" },
      };
    });
    getProjectAuth.mockImplementation(async () => {
      return null;
    });
    getUserAuth.mockImplementation(async () => {
      return null;
    });
    refreshProjectAuth.mockImplementation(async () => {
      return undefined;
    });
    refreshUserAuth.mockImplementation(async () => {
      return undefined;
    });
    getCurrentPlan.mockImplementation(async () => {
      return { plan: PlanType.Growth, isSubscriptionUnpaid: false };
    });
    bindInstallation.mockImplementation(async () => {
      return 1;
    });
    importRepositories.mockImplementation(async () => {
      return { imported: 1, skipped: 0 };
    });
    verifyInstallation.mockImplementation(async () => {
      return undefined;
    });

    // No test reaches Slack, Microsoft or GitHub unless it stubs the call.
    postSpy = jest.spyOn(API, "post").mockImplementation(async () => {
      throw new Error("Unexpected API.post");
    });
    getSpy = jest.spyOn(API, "get").mockImplementation(async () => {
      throw new Error("Unexpected API.get");
    });

    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(
        async (data: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          if (!callbackMembership) {
            throw new NotAuthorizedException(
              WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
            );
          }

          return {
            userId: data.userId,
            tenantId: data.projectId,
            userTenantAccessPermission: {
              [data.projectId.toString()]: {
                _type: "UserTenantAccessPermission",
                projectId: data.projectId,
                permissions: callbackMembership.map(
                  (permission: Permission) => {
                    return {
                      _type: "UserPermission",
                      permission: permission,
                      labelIds: [],
                      isBlockPermission: false,
                    };
                  },
                ),
              },
            },
            userTeamIds: [],
          };
        },
      );

    jest.spyOn(UserService, "findOneById").mockImplementation(async () => {
      return { isMasterAdmin: false } as any;
    });
  });

  afterEach(() => {
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------- helpers

  function get(
    path: string,
    headers?: Record<string, string>,
  ): Promise<ProbeResponse> {
    return httpGet({
      port: app.port,
      path,
      headers,
      timeoutMs: ANSWER_WITHIN_MS,
    });
  }

  function signedInHeaders(): Record<string, string> {
    return {
      [TEST_USER_HEADER]: userId.toString(),
      tenantid: projectId.toString(),
      [TEST_PERMISSIONS_HEADER]: Permission.ProjectOwner,
    };
  }

  async function startFlow(
    path: string,
    urlKey: string = "authorizationUrl",
  ): Promise<{ state: string; browser: Browser }> {
    const response: ProbeResponse = await get(path, signedInHeaders());

    expect(response.status).toBe(200);

    const url: string = (response.body as JSONObject)[urlKey] as string;

    return {
      state: queryOf(url).get("state")!,
      browser: { [COOKIE_NAME]: response.setCookies[COOKIE_NAME]! },
    };
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

  function slackPage(): string {
    return `${DashboardClientUrl.toString()}/${projectId.toString()}/settings/slack-integration`;
  }

  function teamsPage(): string {
    return `${DashboardClientUrl.toString()}/${projectId.toString()}/settings/microsoft-teams-integration`;
  }

  function codeRepositoryPage(): string {
    return `${DashboardClientUrl.toString()}/${projectId.toString()}/code-repository`;
  }

  function connectReturnPage(): string {
    return `${DashboardClientUrl.toString()}/connect-return`;
  }

  // The browser is sent back to `page`, told `code`.
  function expectAnsweredOn(
    response: ProbeResponse,
    page: string,
    code: string | null,
  ): void {
    expect(response.status).toBe(302);
    expect(response.location).toBeDefined();

    const location: string = response.location!;

    expect(location.split("?")[0]).toBe(page);

    const error: string | null = queryOf(location).get("error");

    if (error) {
      answeredCodes.add(error);
    }

    expect(error).toBe(code);
  }

  // Nothing `text` said reaches the browser: not the redirect, not a body.
  function expectNotShown(response: ProbeResponse, text: string): void {
    expect(decodeURIComponent(response.location || "")).not.toContain(text);
    expect(JSON.stringify(response.body || "")).not.toContain(text);
  }

  function expectNothingWritten(): void {
    expect(refreshProjectAuth).not.toHaveBeenCalled();
    expect(refreshUserAuth).not.toHaveBeenCalled();
    expect(bindInstallation).not.toHaveBeenCalled();
    expect(importRepositories).not.toHaveBeenCalled();
  }

  function slackInstallCallback(): string {
    return `/api/slack/auth/${projectId.toString()}/${userId.toString()}`;
  }

  function slackSignInCallback(): string {
    return `${slackInstallCallback()}/user`;
  }

  function slackInstallAnswers(body: JSONObject): void {
    postSpy.mockImplementation(async () => {
      return new HTTPResponse<JSONObject>(200, body, {}) as any;
    });
  }

  function slackSignInAnswers(idToken: unknown): void {
    postSpy.mockImplementation(async () => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          ok: true,
          access_token: "xoxp-user-token",
          ...(idToken === undefined ? {} : { id_token: idToken as string }),
        },
        {},
      ) as any;
    });
  }

  function slackSignInToken(teamId: string = "T0123ABC456"): string {
    return makeUnsignedJwt({
      "https://slack.com/team_id": teamId,
      "https://slack.com/user_id": "U123",
    });
  }

  const SLACK_INSTALL_OK: JSONObject = {
    ok: true,
    access_token: "xoxb-bot-token",
    bot_user_id: "UBOT",
    team: { id: "T0123ABC456", name: "Acme" },
    authed_user: { id: "U123", access_token: "xoxp-user-token" },
  };

  // Microsoft's answers to a token request and a Graph read, by default fine.
  function microsoftAnswers(options?: {
    signInToken?: (nonce: string) => unknown;
    signInTokenFails?: boolean;
    appTokenFails?: boolean;
    teams?: Array<JSONObject> | "fails";
    profileFails?: boolean;
    userTokenFails?: boolean;
  }): void {
    postSpy.mockImplementation(async (request: any) => {
      const grantType: string = request.data["grant_type"];

      if (grantType === "authorization_code" && request.data["scope"]) {
        const isAdminConsentSignIn: boolean =
          request.data["scope"] === "openid profile";

        if (isAdminConsentSignIn) {
          if (options?.signInTokenFails) {
            return new HTTPErrorResponse(
              400,
              { error: "AADSTS70008: upstream-code-expired" },
              {},
            );
          }

          return new HTTPResponse<JSONObject>(
            200,
            {
              id_token: (options?.signInToken ||
                ((nonce: string): unknown => {
                  return makeUnsignedJwt({
                    aud: TEAMS_CLIENT_ID,
                    iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
                    tid: TENANT_ID,
                    nonce: nonce,
                    exp: Math.floor(Date.now() / 1000) + 3600,
                  });
                }))(currentNonce) as string,
            },
            {},
          ) as any;
        }

        if (options?.userTokenFails) {
          return new HTTPErrorResponse(
            400,
            { error: "AADSTS9002313: upstream-invalid-request" },
            {},
          );
        }

        return new HTTPResponse<JSONObject>(
          200,
          { access_token: "user-access-token" },
          {},
        ) as any;
      }

      if (grantType === "client_credentials") {
        if (options?.appTokenFails) {
          return new HTTPErrorResponse(
            401,
            { error: "AADSTS7000215: upstream-invalid-secret" },
            {},
          );
        }

        return new HTTPResponse<JSONObject>(
          200,
          { access_token: "graph-app-token", expires_in: 3599 },
          {},
        ) as any;
      }

      throw new Error(`Unexpected token request ${grantType}`);
    });

    getSpy.mockImplementation(async (request: any) => {
      const url: string = request.url.toString();

      if (url.includes("/v1.0/me")) {
        if (options?.profileFails) {
          return new HTTPErrorResponse(
            403,
            { error: { message: "upstream-graph-forbidden" } },
            {},
          );
        }

        return new HTTPResponse<JSONObject>(
          200,
          { id: "aad-user", displayName: "Ada", mail: "ada@example.com" },
          {},
        ) as any;
      }

      if (url.includes("/v1.0/teams")) {
        if (options?.teams === "fails") {
          return new HTTPErrorResponse(
            503,
            { error: { message: "upstream-graph-unavailable" } },
            {},
          );
        }

        return new HTTPResponse<JSONObject>(
          200,
          {
            value: options?.teams || [{ id: "team-1", displayName: "Ops" }],
          },
          {},
        ) as any;
      }

      throw new Error(`Unexpected API.get ${url}`);
    });
  }

  // The nonce the admin-consent sign-in leg was started with.
  let currentNonce: string = "";

  const ADMIN_CONSENT_CALLBACK: string =
    "/api/microsoft-teams/admin-consent/callback";

  // Runs admin consent up to the sign-in leg; what the second leg needs.
  async function throughConsentScreen(): Promise<{
    signInState: string;
    browser: Browser;
  }> {
    const start: { state: string; browser: Browser } = await startFlow(
      "/api/microsoft-teams/admin-consent",
    );

    const leg1: ProbeResponse = await callback(
      ADMIN_CONSENT_CALLBACK,
      { tenant: TENANT_ID, admin_consent: "True", state: start.state },
      start.browser,
    );

    expect(leg1.status).toBe(302);
    expect(leg1.location!.startsWith("https://login.microsoftonline.com/")).toBe(
      true,
    );

    currentNonce = queryOf(leg1.location!).get("nonce")!;

    return {
      signInState: queryOf(leg1.location!).get("state")!,
      browser: start.browser,
    };
  }

  function githubConnectQuery(
    state: string,
    overrides?: Record<string, string>,
  ): Record<string, string> {
    return {
      state: state,
      installation_id: "424242",
      code: "github-oauth-code",
      setup_action: "install",
      ...(overrides || {}),
    };
  }

  // ------------------------------------------------------- Slack: install

  describe("Slack: installing the app", () => {
    test("connects, and goes back to the Slack page with nothing to say", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");
      slackInstallAnswers(SLACK_INSTALL_OK);

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), null);
      expect(refreshProjectAuth).toHaveBeenCalledTimes(1);
    });

    test("a token request Slack answers with an error is answered on the Slack page, never with what Slack said", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");
      postSpy.mockImplementation(async () => {
        return new HTTPErrorResponse(
          500,
          { error: "upstream-invalid-client-secret" },
          {},
        );
      });

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expectNotShown(response, "upstream-invalid-client-secret");
      expectNothingWritten();
    });

    test("a token request that rejects with something that is not an Error is answered", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");
      postSpy.mockImplementation(async () => {
        throw NOT_AN_ERROR;
      });

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expectNotShown(response, "upstream-secret-detail");
      expectNothingWritten();
    });

    test("Slack answering without ok is answered on the Slack page", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");
      slackInstallAnswers({ ok: false, error: "upstream-invalid-code" });

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expectNotShown(response, "upstream-invalid-code");
      expectNothingWritten();
    });

    test("a write that fails is answered on the Slack page, never with what failed", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");
      slackInstallAnswers(SLACK_INSTALL_OK);
      refreshProjectAuth.mockImplementation(async () => {
        throw new Error(
          'duplicate key value violates unique constraint "WorkspaceProjectAuthToken_pkey"',
        );
      });

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expectNotShown(response, "WorkspaceProjectAuthToken_pkey");
    });

    test("no code from Slack is answered on the Slack page", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expect(postSpy).not.toHaveBeenCalled();
    });

    test("cancelling on Slack is answered with a code, never Slack's own words", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { error: "access_denied", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "cancelled");
      expectNotShown(response, "access_denied");
      expectNothingWritten();
    });

    test("any other error Slack reports is answered plainly", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { error: "<b>upstream-text</b>", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expectNotShown(response, "upstream-text");
      expectNothingWritten();
    });

    test("someone who may no longer connect the project is told so on the Slack page", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");
      callbackMembership = [Permission.Viewer];

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "no-permission");
      expect(postSpy).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("someone who left the project is told the same, on the Slack page", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");
      callbackMembership = null;

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "no-permission");
      expectNothingWritten();
    });

    test("a check that fails is answered plainly on the Slack page", async () => {
      const { state, browser } = await startFlow("/api/slack/install-url");
      (
        WorkspaceActionAuthorization.getProjectMemberProps as unknown as jest.Mock
      ).mockImplementationOnce(async () => {
        throw new Error('relation "TeamMember" does not exist');
      });

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expectNotShown(response, "TeamMember");
      expectNothingWritten();
    });

    test("a link that cannot be used is answered on the Dashboard, which opens the Slack page", async () => {
      const response: ProbeResponse = await callback(slackInstallCallback(), {
        code: "slack-code",
        state: crypto.randomBytes(32).toString("base64url"),
      });

      expectAnsweredOn(response, connectReturnPage(), "link-invalid");
      expect(queryOf(response.location!).get("provider")).toBe("slack");
      expectNothingWritten();
    });

    test("started on User Settings, it goes back to User Settings", async () => {
      const { state, browser } = await startFlow(
        "/api/slack/install-url?from=user-settings",
      );
      slackInstallAnswers(SLACK_INSTALL_OK);

      const response: ProbeResponse = await callback(
        slackInstallCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(
        response,
        `${DashboardClientUrl.toString()}/${projectId.toString()}/user-settings/slack-integration`,
        null,
      );
    });
  });

  // ------------------------------------------------------- Slack: sign-in

  describe("Slack: signing in with Slack", () => {
    test("links the account, and goes back to the Slack page with nothing to say", async () => {
      const { state, browser } = await startFlow("/api/slack/sign-in-url");
      slackSignInAnswers(slackSignInToken());

      const response: ProbeResponse = await callback(
        slackSignInCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), null);
      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
    });

    test("a token request Slack answers with an error is answered on the Slack page", async () => {
      const { state, browser } = await startFlow("/api/slack/sign-in-url");
      postSpy.mockImplementation(async () => {
        return new HTTPErrorResponse(
          502,
          { error: "upstream-bad-gateway" },
          {},
        );
      });

      const response: ProbeResponse = await callback(
        slackSignInCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expectNotShown(response, "upstream-bad-gateway");
      expectNothingWritten();
    });

    test("an identity token that cannot be read is answered on the Slack page", async () => {
      const { state, browser } = await startFlow("/api/slack/sign-in-url");
      slackSignInAnswers("header.bm90LWpzb24.signature");

      const response: ProbeResponse = await callback(
        slackSignInCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expectNothingWritten();
    });

    test("no identity token at all is answered on the Slack page", async () => {
      const { state, browser } = await startFlow("/api/slack/sign-in-url");
      slackSignInAnswers(undefined);

      const response: ProbeResponse = await callback(
        slackSignInCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expectNothingWritten();
    });

    test("a write that fails is answered on the Slack page", async () => {
      const { state, browser } = await startFlow("/api/slack/sign-in-url");
      slackSignInAnswers(slackSignInToken());
      refreshUserAuth.mockImplementation(async () => {
        throw NOT_AN_ERROR;
      });

      const response: ProbeResponse = await callback(
        slackSignInCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "could-not-finish");
      expectNotShown(response, "upstream-secret-detail");
    });

    test("a Slack account from another workspace is answered with its code", async () => {
      const { state, browser } = await startFlow("/api/slack/sign-in-url");
      slackSignInAnswers(slackSignInToken("T9999OTHER"));

      const response: ProbeResponse = await callback(
        slackSignInCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "slack-other-workspace");
      expectNotShown(response, "Acme");
      expectNothingWritten();
    });

    test("a project not connected to Slack yet is answered with its code", async () => {
      const { state, browser } = await startFlow("/api/slack/sign-in-url");
      slackSignInAnswers(slackSignInToken());
      findSlackProjectAuth.mockImplementation(async () => {
        return null;
      });

      const response: ProbeResponse = await callback(
        slackSignInCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "slack-not-installed");
      expectNothingWritten();
    });

    test("someone who left the project is told they are not a member", async () => {
      const { state, browser } = await startFlow("/api/slack/sign-in-url");
      callbackMembership = null;

      const response: ProbeResponse = await callback(
        slackSignInCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(response, slackPage(), "not-a-member");
      expect(postSpy).not.toHaveBeenCalled();
    });

    test("a link that cannot be used is answered on the Dashboard", async () => {
      const response: ProbeResponse = await callback(slackSignInCallback(), {
        code: "slack-code",
      });

      expectAnsweredOn(response, connectReturnPage(), "link-invalid");
      expect(queryOf(response.location!).get("provider")).toBe("slack");
    });

    test("started on User Settings, a refusal goes back to User Settings", async () => {
      const { state, browser } = await startFlow(
        "/api/slack/sign-in-url?from=user-settings",
      );
      callbackMembership = null;

      const response: ProbeResponse = await callback(
        slackSignInCallback(),
        { code: "slack-code", state },
        browser,
      );

      expectAnsweredOn(
        response,
        `${DashboardClientUrl.toString()}/${projectId.toString()}/user-settings/slack-integration`,
        "not-a-member",
      );
    });
  });

  // ----------------------------------------------- Microsoft Teams: sign-in

  describe("Microsoft Teams: signing in with Microsoft", () => {
    const SIGN_IN_CALLBACK: string = "/api/microsoft-teams/auth";

    test("links the account, and sends the admin on to consent when it is still needed", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/sign-in-url",
      );
      microsoftAnswers();

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { code: "ms-code", state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), null);
      expect(queryOf(response.location!).get("needAdminConsent")).toBe("true");
      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
    });

    test("a token request Microsoft refuses is answered on the Teams page, never with what Microsoft said", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/sign-in-url",
      );
      microsoftAnswers({ userTokenFails: true });

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { code: "ms-code", state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
      expectNotShown(response, "upstream-invalid-request");
      expectNotShown(response, "AADSTS");
      expectNothingWritten();
    });

    test("a profile read that fails is answered on the Teams page", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/sign-in-url",
      );
      microsoftAnswers({ profileFails: true });

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { code: "ms-code", state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
      expectNotShown(response, "upstream-graph-forbidden");
      expectNothingWritten();
    });

    test("a write that fails is answered on the Teams page", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/sign-in-url",
      );
      microsoftAnswers();
      refreshUserAuth.mockImplementation(async () => {
        throw NOT_AN_ERROR;
      });

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { code: "ms-code", state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
    });

    test("cancelling at Microsoft is answered with a code, never Microsoft's description", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/sign-in-url",
      );

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        {
          error: "access_denied",
          error_description: "AADSTS65004: upstream user declined",
          state,
        },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "cancelled");
      expectNotShown(response, "AADSTS65004");
      expectNothingWritten();
    });

    test("no code from Microsoft is answered on the Teams page", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/sign-in-url",
      );

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
    });

    test("someone who left the project is told they are not a member, on the Teams page", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/sign-in-url",
      );
      callbackMembership = null;

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { code: "ms-code", state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "not-a-member");
      expect(postSpy).not.toHaveBeenCalled();
    });

    test("a check that fails is answered plainly on the Teams page", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/sign-in-url",
      );
      (
        WorkspaceActionAuthorization.getProjectMemberProps as unknown as jest.Mock
      ).mockImplementationOnce(async () => {
        throw new Error('relation "TeamMember" does not exist');
      });

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { code: "ms-code", state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
      expectNotShown(response, "TeamMember");
    });

    test("a link that cannot be used is answered on the Dashboard, which opens the Teams page", async () => {
      const response: ProbeResponse = await callback(SIGN_IN_CALLBACK, {
        code: "ms-code",
        state: crypto.randomBytes(32).toString("base64url"),
      });

      expectAnsweredOn(response, connectReturnPage(), "link-invalid");
      expect(queryOf(response.location!).get("provider")).toBe(
        "microsoft-teams",
      );
    });

    test("a state that cannot even be read is answered on the Dashboard, never left hanging", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/sign-in-url",
      );
      (
        (GlobalCache as any).getAndDeleteString as jest.Mock
      ).mockImplementationOnce(async () => {
        throw NOT_AN_ERROR;
      });

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { code: "ms-code", state },
        browser,
      );

      expect(response.status).toBe(302);
      expect(response.location!.split("?")[0]).toBe(connectReturnPage());
      expectNotShown(response, "upstream-secret-detail");
    });
  });

  // ------------------------------------------ Microsoft Teams: admin consent

  describe("Microsoft Teams: admin consent", () => {
    test("binds the tenant, and goes back to the Teams page with nothing to say", async () => {
      const { signInState, browser } = await throughConsentScreen();
      microsoftAnswers();

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { code: "ms-code", state: signInState },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), null);
      expect(queryOf(response.location!).get("adminConsent")).toBe("success");
      expect(refreshProjectAuth).toHaveBeenCalledTimes(1);
    });

    test("Microsoft's own error is answered with a code, never its description", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/admin-consent",
      );

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        {
          error: "access_denied",
          error_description: "AADSTS65004: upstream admin declined consent",
          state,
        },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "cancelled");
      expectNotShown(response, "AADSTS65004");
      expectNotShown(response, "upstream admin declined");
    });

    test("any other error Microsoft reports is answered plainly", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/admin-consent",
      );

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        {
          error: "invalid_request",
          error_description: "AADSTS90014: upstream missing field",
          state,
        },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
      expectNotShown(response, "AADSTS90014");
    });

    test("consent reported as not granted is answered as cancelled", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/admin-consent",
      );

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { tenant: TENANT_ID, admin_consent: "False", state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "cancelled");
    });

    test("consent for a tenant other than the project's is answered with its code", async () => {
      getProjectAuth.mockImplementation(async () => {
        return {
          workspaceProjectId: TENANT_ID,
          miscData: { tenantId: TENANT_ID },
        };
      });
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/admin-consent",
      );

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { tenant: OTHER_TENANT_ID, admin_consent: "True", state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "teams-other-tenant");
      expectNothingWritten();
    });

    test("a missing tenant is answered plainly", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/admin-consent",
      );

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { admin_consent: "True", state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
    });

    test("someone who may no longer connect the project is told so on the Teams page", async () => {
      const { state, browser } = await startFlow(
        "/api/microsoft-teams/admin-consent",
      );
      callbackMembership = [Permission.Viewer];

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { tenant: TENANT_ID, admin_consent: "True", state },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "no-permission");
      expectNotShown(response, "You do not have permission");
    });

    test("a sign-in code Microsoft will not exchange is answered plainly", async () => {
      const { signInState, browser } = await throughConsentScreen();
      microsoftAnswers({ signInTokenFails: true });

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { code: "ms-code", state: signInState },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
      expectNotShown(response, "AADSTS70008");
      expectNothingWritten();
    });

    test("a sign-in to another tenant is answered with its code", async () => {
      const { signInState, browser } = await throughConsentScreen();
      microsoftAnswers({
        signInToken: (nonce: string): unknown => {
          return makeUnsignedJwt({
            aud: TEAMS_CLIENT_ID,
            iss: `https://login.microsoftonline.com/${OTHER_TENANT_ID}/v2.0`,
            tid: OTHER_TENANT_ID,
            nonce: nonce,
            exp: Math.floor(Date.now() / 1000) + 3600,
          });
        },
      });

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { code: "ms-code", state: signInState },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "teams-other-tenant");
      expectNothingWritten();
    });

    test("an ID token that does not check out is answered plainly", async () => {
      const { signInState, browser } = await throughConsentScreen();
      microsoftAnswers({
        signInToken: (): unknown => {
          return "not-a-token";
        },
      });

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { code: "ms-code", state: signInState },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
      expectNothingWritten();
    });

    test("an app token Microsoft refuses is answered plainly", async () => {
      const { signInState, browser } = await throughConsentScreen();
      microsoftAnswers({ appTokenFails: true });

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { code: "ms-code", state: signInState },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
      expectNotShown(response, "AADSTS7000215");
      expectNothingWritten();
    });

    test("a tenant with no teams is answered with its code", async () => {
      const { signInState, browser } = await throughConsentScreen();
      microsoftAnswers({ teams: [] });

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { code: "ms-code", state: signInState },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "teams-no-teams");
      expectNothingWritten();
    });

    test("a teams read that fails is answered plainly", async () => {
      const { signInState, browser } = await throughConsentScreen();
      microsoftAnswers({ teams: "fails" });

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { code: "ms-code", state: signInState },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
      expectNotShown(response, "upstream-graph-unavailable");
    });

    test("a write that fails is answered plainly", async () => {
      const { signInState, browser } = await throughConsentScreen();
      microsoftAnswers();
      refreshProjectAuth.mockImplementation(async () => {
        throw new Error('null value in column "authToken" violates not-null');
      });

      const response: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { code: "ms-code", state: signInState },
        browser,
      );

      expectAnsweredOn(response, teamsPage(), "could-not-finish");
      expectNotShown(response, "authToken");
    });

    test("a link that cannot be used is answered on the Dashboard", async () => {
      const response: ProbeResponse = await callback(ADMIN_CONSENT_CALLBACK, {
        tenant: TENANT_ID,
        admin_consent: "True",
      });

      expectAnsweredOn(response, connectReturnPage(), "link-invalid");
      expect(queryOf(response.location!).get("provider")).toBe(
        "microsoft-teams",
      );
    });

    test("started on User Settings, the sign-in leg keeps going back there", async () => {
      const start: { state: string; browser: Browser } = await startFlow(
        "/api/microsoft-teams/admin-consent?from=user-settings",
      );

      const leg1: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { tenant: TENANT_ID, admin_consent: "True", state: start.state },
        start.browser,
      );

      currentNonce = queryOf(leg1.location!).get("nonce")!;
      microsoftAnswers({ teams: [] });

      const leg2: ProbeResponse = await callback(
        ADMIN_CONSENT_CALLBACK,
        { code: "ms-code", state: queryOf(leg1.location!).get("state")! },
        start.browser,
      );

      expectAnsweredOn(
        leg2,
        `${DashboardClientUrl.toString()}/${projectId.toString()}/user-settings/microsoft-teams-integration`,
        "teams-no-teams",
      );
    });
  });

  // -------------------------------------------------------------- GitHub

  describe("GitHub: connecting an installation", () => {
    const GITHUB_CALLBACK: string = "/api/github/auth/callback";

    function startGitHub(): Promise<{ state: string; browser: Browser }> {
      return startFlow("/api/github/install-url", "installUrl");
    }

    test("connects, and goes back to Code Repositories with the installation", async () => {
      const { state, browser } = await startGitHub();

      const response: ProbeResponse = await callback(
        GITHUB_CALLBACK,
        githubConnectQuery(state),
        browser,
      );

      expectAnsweredOn(response, codeRepositoryPage(), null);
      expect(queryOf(response.location!).get("installation_id")).toBe("424242");
    });

    test("an installation GitHub does not confirm is answered with its code, never with what GitHub said", async () => {
      const { state, browser } = await startGitHub();
      verifyInstallation.mockImplementation(async () => {
        throw new Error(
          "Request failed with status code 502: <html>upstream-github-gateway</html>",
        );
      });

      const response: ProbeResponse = await callback(
        GITHUB_CALLBACK,
        githubConnectQuery(state),
        browser,
      );

      expectAnsweredOn(response, codeRepositoryPage(), "github-not-verified");
      expectNotShown(response, "upstream-github-gateway");
      expectNotShown(response, "status code 502");
      expectNothingWritten();
    });

    test("a verification that rejects with something that is not an Error is answered", async () => {
      const { state, browser } = await startGitHub();
      verifyInstallation.mockImplementation(async () => {
        throw NOT_AN_ERROR;
      });

      const response: ProbeResponse = await callback(
        GITHUB_CALLBACK,
        githubConnectQuery(state),
        browser,
      );

      expectAnsweredOn(response, codeRepositoryPage(), "github-not-verified");
      expectNotShown(response, "upstream-secret-detail");
      expectNothingWritten();
    });

    test("no installation from GitHub is answered with its code", async () => {
      const { state, browser } = await startGitHub();
      const query: Record<string, string> = githubConnectQuery(state);
      delete query["installation_id"];

      const response: ProbeResponse = await callback(
        GITHUB_CALLBACK,
        query,
        browser,
      );

      expectAnsweredOn(response, codeRepositoryPage(), "github-no-installation");
      expect(verifyInstallation).not.toHaveBeenCalled();
    });

    test("no authorization code from GitHub is answered with its code", async () => {
      const { state, browser } = await startGitHub();
      const query: Record<string, string> = githubConnectQuery(state);
      delete query["code"];

      const response: ProbeResponse = await callback(
        GITHUB_CALLBACK,
        query,
        browser,
      );

      expectAnsweredOn(
        response,
        codeRepositoryPage(),
        "github-no-authorization",
      );
      expect(verifyInstallation).not.toHaveBeenCalled();
    });

    test("cancelling the authorization on GitHub is answered as cancelled", async () => {
      const { state, browser } = await startGitHub();

      const response: ProbeResponse = await callback(
        GITHUB_CALLBACK,
        {
          state,
          error: "access_denied",
          error_description: "upstream: The user has denied your application",
        },
        browser,
      );

      expectAnsweredOn(response, codeRepositoryPage(), "cancelled");
      expectNotShown(response, "denied your application");
      expectNothingWritten();
    });

    test("someone who may no longer add code repositories is told so on Code Repositories", async () => {
      const { state, browser } = await startGitHub();
      callbackMembership = [Permission.Viewer];

      const response: ProbeResponse = await callback(
        GITHUB_CALLBACK,
        githubConnectQuery(state),
        browser,
      );

      expectAnsweredOn(response, codeRepositoryPage(), "no-permission");
      expect(verifyInstallation).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("a project that dropped below the plan is told which plan it needs, on Code Repositories", async () => {
      setTestBillingEnabled(true);
      const { state, browser } = await startGitHub();
      getCurrentPlan.mockImplementation(async () => {
        return { plan: PlanType.Free, isSubscriptionUnpaid: false };
      });

      const response: ProbeResponse = await callback(
        GITHUB_CALLBACK,
        githubConnectQuery(state),
        browser,
      );

      expectAnsweredOn(response, codeRepositoryPage(), "plan-required");
      expectNothingWritten();
    });

    test("a binding that cannot be written is answered plainly, never with what failed", async () => {
      const { state, browser } = await startGitHub();
      bindInstallation.mockImplementation(async () => {
        throw new Error(
          'duplicate key value violates unique constraint "Project_pkey"',
        );
      });

      const response: ProbeResponse = await callback(
        GITHUB_CALLBACK,
        githubConnectQuery(state),
        browser,
      );

      expectAnsweredOn(response, codeRepositoryPage(), "could-not-finish");
      expectNotShown(response, "Project_pkey");
      expect(importRepositories).not.toHaveBeenCalled();
    });

    test("a check that fails is answered plainly on Code Repositories", async () => {
      const { state, browser } = await startGitHub();
      (
        WorkspaceActionAuthorization.getProjectMemberProps as unknown as jest.Mock
      ).mockImplementationOnce(async () => {
        throw NOT_AN_ERROR;
      });

      const response: ProbeResponse = await callback(
        GITHUB_CALLBACK,
        githubConnectQuery(state),
        browser,
      );

      expectAnsweredOn(response, codeRepositoryPage(), "could-not-finish");
      expect(verifyInstallation).not.toHaveBeenCalled();
    });

    test("a link that cannot be used is answered on the Dashboard, which opens Code Repositories", async () => {
      const response: ProbeResponse = await callback(GITHUB_CALLBACK, {
        installation_id: "424242",
        code: "github-oauth-code",
        setup_action: "install",
        state: crypto.randomBytes(32).toString("base64url"),
      });

      expectAnsweredOn(response, connectReturnPage(), "link-invalid");
      expect(queryOf(response.location!).get("provider")).toBe("github");
      expectNothingWritten();
    });

    test("GitHub's own redirect after an installation is changed there goes to Code Repositories, with nothing to refuse", async () => {
      // "Redirect on update": GitHub sends no state of ours.
      const response: ProbeResponse = await callback(GITHUB_CALLBACK, {
        installation_id: "424242",
        setup_action: "update",
      });

      expectAnsweredOn(response, connectReturnPage(), null);
      expect(queryOf(response.location!).get("provider")).toBe("github");
      expect(verifyInstallation).not.toHaveBeenCalled();
      expectNothingWritten();
    });
  });
});
