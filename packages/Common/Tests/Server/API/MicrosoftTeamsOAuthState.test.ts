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
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import {
  AppApiClientUrl,
  DashboardClientUrl,
} from "../../../Server/EnvironmentConfig";
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
 * The Microsoft Teams connect flows end in unauthenticated callbacks that
 * write the project's Teams binding: the admin-consent callback stores a
 * tenant's Graph app token on a project, and /microsoft-teams/auth links a
 * Microsoft identity to a OneUptime user. These tests drive the real routes
 * over HTTP and pin that the callbacks trust only a single-use, browser-bound
 * state issued to an authorised member, and that the tenant bound is the one
 * an ID token proves, never a query parameter.
 */

const TEAMS_CLIENT_ID: string = "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80";
const TENANT_ID: string = "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11";
const OTHER_TENANT_ID: string = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80",
    MicrosoftTeamsAppClientSecret: "teams-client-secret",
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
      getCurrentPlan: jest.fn(async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      }),
    },
  };
});

const ADMIN_CONSENT_START: string = "/api/microsoft-teams/admin-consent";
const ADMIN_CONSENT_CALLBACK: string =
  "/api/microsoft-teams/admin-consent/callback";
const SIGN_IN_START: string = "/api/microsoft-teams/sign-in-url";
const SIGN_IN_CALLBACK: string = "/api/microsoft-teams/auth";

const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;

// What the in-memory GlobalCache has recorded (see createInMemoryGlobalCache).
const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

type Browser = Record<string, string>;

function withQuery(path: string, query: Record<string, string>): string {
  return `${path}?${new URLSearchParams(query).toString()}`;
}

describe("Microsoft Teams OAuth state", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;
  let postSpy: jest.SpyInstance;
  let getSpy: jest.SpyInstance;

  const getProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.getProjectAuth as unknown as jest.Mock;
  const refreshProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.refreshAuthToken as unknown as jest.Mock;
  const refreshUserAuth: jest.Mock =
    WorkspaceUserAuthTokenService.refreshAuthToken as unknown as jest.Mock;
  const getUserAuth: jest.Mock =
    WorkspaceUserAuthTokenService.getUserAuth as unknown as jest.Mock;

  // Loading the API pulls in a large module graph; give it its own budget.
  beforeAll(async () => {
    const MicrosoftTeamsAPI: any = (
      await import("../../../Server/API/MicrosoftTeamsAPI")
    ).default;

    app = await startApp([new MicrosoftTeamsAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockCacheStore.clear();
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();

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

    // No test may reach Microsoft unless it stubs the call itself.
    postSpy = jest.spyOn(API, "post").mockImplementation(async () => {
      throw new Error("Unexpected API.post");
    });
    getSpy = jest.spyOn(API, "get").mockImplementation(async () => {
      throw new Error("Unexpected API.get");
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function signedInHeaders(options?: {
    permissions?: Array<Permission> | undefined;
    memberOf?: ObjectID | undefined;
    browser?: Browser | undefined;
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

    if (options?.browser && Object.keys(options.browser).length > 0) {
      headers["cookie"] = cookieHeader(options.browser);
    }

    return headers;
  }

  function get(
    path: string,
    headers?: Record<string, string>,
  ): Promise<ProbeResponse> {
    return httpGet({ port: app.port, path, headers });
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

  // Starts a flow as the signed-in user and returns the state plus the browser's cookies.
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

  function stubSignInTokenExchange(claims: Partial<JSONObject> = {}): void {
    postSpy.mockImplementation(async (options: any) => {
      const grantType: string = options.data["grant_type"];

      if (grantType === "authorization_code") {
        return new HTTPResponse<JSONObject>(
          200,
          {
            id_token: makeUnsignedJwt({
              aud: TEAMS_CLIENT_ID,
              iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
              tid: TENANT_ID,
              nonce: claims["nonce"] as string,
              exp: Math.floor(Date.now() / 1000) + 3600,
              ...claims,
            } as JSONObject),
            access_token: "user-access-token",
          },
          {},
        ) as any;
      }

      if (grantType === "client_credentials") {
        return new HTTPResponse<JSONObject>(
          200,
          { access_token: "graph-app-token", expires_in: 3599 },
          {},
        ) as any;
      }

      throw new Error(`Unexpected grant_type ${grantType}`);
    });

    getSpy.mockImplementation(async () => {
      return new HTTPResponse<JSONObject>(
        200,
        { value: [{ id: "team-1", displayName: "Operations" }] },
        {},
      ) as any;
    });
  }

  // Runs the admin-consent start and leg 1, returning what leg 2 needs.
  async function completeConsentScreen(): Promise<{
    signInState: string;
    oidcNonce: string;
    signInUrl: string;
    browser: Browser;
  }> {
    const start: { state: string; browser: Browser } =
      await startFlow(ADMIN_CONSENT_START);

    const leg1: ProbeResponse = await callback(
      ADMIN_CONSENT_CALLBACK,
      { tenant: TENANT_ID, admin_consent: "True", state: start.state },
      start.browser,
    );

    expect(leg1.status).toBe(302);

    return {
      signInState: queryOf(leg1.location!).get("state")!,
      oidcNonce: queryOf(leg1.location!).get("nonce")!,
      signInUrl: leg1.location!,
      browser: start.browser,
    };
  }

  function expectNothingWritten(): void {
    expect(refreshProjectAuth).not.toHaveBeenCalled();
    expect(refreshUserAuth).not.toHaveBeenCalled();
  }

  function expectNoTokenRequested(): void {
    expect(postSpy).not.toHaveBeenCalled();
  }

  describe("GET /microsoft-teams/admin-consent (start)", () => {
    test("refuses an anonymous caller and issues no state", async () => {
      const response: ProbeResponse = await get(
        withQuery(ADMIN_CONSENT_START, {
          state: `${projectId.toString()}:${userId.toString()}`,
        }),
        { tenantid: projectId.toString() },
      );

      expect(response.status).toBe(401);
      expect(mockCacheStore.size).toBe(0);
      expect(response.setCookies[COOKIE_NAME]).toBeUndefined();
    });

    test("refuses a signed-in user who is not a member of the project", async () => {
      const response: ProbeResponse = await get(
        ADMIN_CONSENT_START,
        signedInHeaders({ memberOf: ObjectID.generate() }),
      );

      // NotAuthorizedException is answered with 422 throughout the API.
      expect(response.status).toBe(422);
      expect(mockCacheStore.size).toBe(0);
    });

    test("refuses a read-only member", async () => {
      const response: ProbeResponse = await get(
        ADMIN_CONSENT_START,
        signedInHeaders({ permissions: [Permission.Viewer] }),
      );

      expect(response.status).toBe(422);
      expect((response.body as JSONObject)["message"]).toBe(
        "You do not have permission to connect this project to Microsoft Teams.",
      );
      expect(mockCacheStore.size).toBe(0);
    });

    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ])(
      "issues an opaque state to a %s and returns the consent URL",
      async (permission: Permission) => {
        const { state, url, browser } = await startFlow(ADMIN_CONSENT_START, {
          permissions: [permission],
        });

        expect(
          url.startsWith(
            "https://login.microsoftonline.com/organizations/v2.0/adminconsent?",
          ),
        ).toBe(true);
        expect(queryOf(url).get("client_id")).toBe(TEAMS_CLIENT_ID);
        expect(queryOf(url).get("redirect_uri")).toBe(
          `${AppApiClientUrl.toString()}/microsoft-teams/admin-consent/callback`,
        );

        expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(url).not.toContain(projectId.toString());
        expect(url).not.toContain(userId.toString());
        expect(browser[COOKIE_NAME]).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(mockCacheStore.size).toBe(1);
      },
    );

    test("ignores a caller-supplied state", async () => {
      const otherProjectId: ObjectID = ObjectID.generate();

      const response: ProbeResponse = await get(
        withQuery(ADMIN_CONSENT_START, {
          state: `${otherProjectId.toString()}:${userId.toString()}`,
        }),
        signedInHeaders(),
      );

      const url: string = (response.body as JSONObject)[
        "authorizationUrl"
      ] as string;

      expect(url).not.toContain(otherProjectId.toString());

      const stored: JSONObject = JSON.parse(
        Array.from(mockCacheStore.values())[0]!.value,
      );
      expect(stored["projectId"]).toBe(projectId.toString());
      expect(stored["userId"]).toBe(userId.toString());
    });

    test("targets the tenant a connected project is already bound to", async () => {
      getProjectAuth.mockImplementation(async () => {
        return {
          workspaceProjectId: TENANT_ID,
          miscData: { adminConsentGranted: true },
        };
      });

      const { url } = await startFlow(ADMIN_CONSENT_START);

      expect(
        url.startsWith(
          `https://login.microsoftonline.com/${TENANT_ID}/v2.0/adminconsent?`,
        ),
      ).toBe(true);
    });
  });

  describe("GET /microsoft-teams/admin-consent/callback", () => {
    describe("forged and spent states", () => {
      test("refuses the legacy <projectId>:<userId> state and requests no token", async () => {
        const response: ProbeResponse = await callback(ADMIN_CONSENT_CALLBACK, {
          tenant: TENANT_ID,
          admin_consent: "True",
          state: `${projectId.toString()}:${userId.toString()}`,
        });

        expect(response.status).toBe(400);
        expect((response.body as JSONObject)["message"]).toBe(
          WorkspaceOAuthState.INVALID_STATE_MESSAGE,
        );
        expectNoTokenRequested();
        expectNothingWritten();
      });

      test("refuses a callback with no state", async () => {
        const response: ProbeResponse = await callback(ADMIN_CONSENT_CALLBACK, {
          tenant: TENANT_ID,
          admin_consent: "True",
        });

        expect(response.status).toBe(400);
        expectNoTokenRequested();
        expectNothingWritten();
      });

      test("refuses a well-formed state OneUptime never issued", async () => {
        const { browser } = await startFlow(ADMIN_CONSENT_START);

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          {
            tenant: TENANT_ID,
            admin_consent: "True",
            state: crypto.randomBytes(32).toString("base64url"),
          },
          browser,
        );

        expect(response.status).toBe(400);
        expectNoTokenRequested();
      });

      test("refuses a state completed in a browser that did not start the flow", async () => {
        const { state } = await startFlow(ADMIN_CONSENT_START);

        // e.g. the consent link was forwarded to someone else's admin.
        const response: ProbeResponse = await callback(ADMIN_CONSENT_CALLBACK, {
          tenant: OTHER_TENANT_ID,
          admin_consent: "True",
          state,
        });

        expect(response.status).toBe(400);
        expectNoTokenRequested();
        expectNothingWritten();
      });

      test("refuses a state completed with another browser's binding cookie", async () => {
        const { state } = await startFlow(ADMIN_CONSENT_START);
        const other: { browser: Browser } =
          await startFlow(ADMIN_CONSENT_START);

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { tenant: TENANT_ID, admin_consent: "True", state },
          other.browser,
        );

        expect(response.status).toBe(400);
      });

      test("refuses a replayed consent-screen state", async () => {
        const { state, browser } = await startFlow(ADMIN_CONSENT_START);
        const query: Record<string, string> = {
          tenant: TENANT_ID,
          admin_consent: "True",
          state,
        };

        expect(
          (await callback(ADMIN_CONSENT_CALLBACK, query, browser)).status,
        ).toBe(302);
        expect(
          (await callback(ADMIN_CONSENT_CALLBACK, query, browser)).status,
        ).toBe(400);
      });

      test("refuses an expired state", async () => {
        const { state, browser } = await startFlow(ADMIN_CONSENT_START);
        const realNow: number = Date.now();

        jest
          .spyOn(Date, "now")
          .mockReturnValue(
            realNow + (WorkspaceOAuthState.EXPIRES_IN_SECONDS + 1) * 1000,
          );

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { tenant: TENANT_ID, admin_consent: "True", state },
          browser,
        );

        expect(response.status).toBe(400);
        expectNoTokenRequested();
      });

      test("refuses a state issued for the Teams user sign-in", async () => {
        const { state, browser } = await startFlow(SIGN_IN_START);

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { tenant: TENANT_ID, admin_consent: "True", state },
          browser,
        );

        expect(response.status).toBe(400);
        expectNoTokenRequested();
      });
    });

    describe("leg 1: back from the consent screen", () => {
      test("binds nothing and sends the admin to sign in to the tenant the redirect named", async () => {
        const { signInUrl, signInState, oidcNonce } =
          await completeConsentScreen();

        expect(
          signInUrl.startsWith(
            `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?`,
          ),
        ).toBe(true);

        const query: URLSearchParams = queryOf(signInUrl);
        expect(query.get("client_id")).toBe(TEAMS_CLIENT_ID);
        expect(query.get("response_type")).toBe("code");
        expect(query.get("scope")).toBe("openid profile");
        expect(query.get("redirect_uri")).toBe(
          `${AppApiClientUrl.toString()}/microsoft-teams/admin-consent/callback`,
        );
        expect(signInState).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(oidcNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);

        // The tenant parameter alone must never produce a token or a binding.
        expectNoTokenRequested();
        expectNothingWritten();
      });

      test("does not accept a code on the consent-screen state", async () => {
        const { state, browser } = await startFlow(ADMIN_CONSENT_START);

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { code: "stolen-code", state },
          browser,
        );

        expect(response.status).toBe(302);
        expect(response.location).toContain("error=");
        expectNoTokenRequested();
        expectNothingWritten();
      });

      test.each([
        ["missing", undefined],
        ["not a GUID", "contoso.onmicrosoft.com"],
        ["a path", `${TENANT_ID}/../../common`],
      ])(
        "refuses a tenant that is %s",
        async (_label: string, tenant: string | undefined) => {
          const { state, browser } = await startFlow(ADMIN_CONSENT_START);

          const query: Record<string, string> = {
            admin_consent: "True",
            state,
          };

          if (tenant) {
            query["tenant"] = tenant;
          }

          const response: ProbeResponse = await callback(
            ADMIN_CONSENT_CALLBACK,
            query,
            browser,
          );

          expect(response.status).toBe(302);
          expect(
            response.location!.startsWith(DashboardClientUrl.toString()),
          ).toBe(true);
          expect(response.location).toContain(
            `/${projectId.toString()}/settings/microsoft-teams-integration`,
          );
          expect(response.location).toContain("error=");
          expectNoTokenRequested();
          expectNothingWritten();
        },
      );

      test("refuses a redirect that does not report consent as granted", async () => {
        const { state, browser } = await startFlow(ADMIN_CONSENT_START);

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { tenant: TENANT_ID, state },
          browser,
        );

        expect(response.location).toContain("error=");
        expect(response.location).not.toContain("login.microsoftonline.com");
      });

      test("reports an error from Microsoft on the project that started the flow", async () => {
        const { state, browser } = await startFlow(ADMIN_CONSENT_START);

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { error: "access_denied", state },
          browser,
        );

        expect(response.status).toBe(302);
        expect(response.location).toContain(
          `/${projectId.toString()}/settings/microsoft-teams-integration`,
        );
        expect(response.location).toContain("error=access_denied");
      });

      test("refuses consent for a tenant other than the one the project is bound to", async () => {
        getProjectAuth.mockImplementation(async () => {
          return { workspaceProjectId: TENANT_ID, miscData: {} };
        });

        const { state, browser } = await startFlow(ADMIN_CONSENT_START);

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { tenant: OTHER_TENANT_ID, admin_consent: "True", state },
          browser,
        );

        expect(response.status).toBe(302);
        expect(response.location).toContain("error=");
        expect(response.location).not.toContain("login.microsoftonline.com");
        expect(mockCacheStore.size).toBe(0);
        expectNoTokenRequested();
        expectNothingWritten();
      });
    });

    describe("leg 2: back from the tenant sign-in", () => {
      test("binds the tenant the ID token proves to the project that started the flow", async () => {
        const { signInState, oidcNonce, browser } =
          await completeConsentScreen();
        stubSignInTokenExchange({ nonce: oidcNonce });

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { code: "sign-in-code", state: signInState },
          browser,
        );

        expect(response.status).toBe(302);
        expect(response.location).toContain(
          `/${projectId.toString()}/settings/microsoft-teams-integration`,
        );
        expect(response.location).toContain("adminConsent=success");

        // Code exchange against the pinned tenant, then client credentials.
        expect(postSpy).toHaveBeenCalledTimes(2);
        const [codeExchange, appToken] = postSpy.mock.calls.map(
          (call: Array<any>) => {
            return call[0];
          },
        );
        expect(codeExchange.url.toString()).toBe(
          `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
        );
        expect(codeExchange.data).toMatchObject({
          grant_type: "authorization_code",
          code: "sign-in-code",
          redirect_uri: `${AppApiClientUrl.toString()}/microsoft-teams/admin-consent/callback`,
        });
        expect(appToken.url.toString()).toBe(
          `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
        );
        expect(appToken.data).toMatchObject({
          grant_type: "client_credentials",
        });

        expect(refreshProjectAuth).toHaveBeenCalledTimes(1);
        const written: JSONObject = refreshProjectAuth.mock
          .calls[0]![0] as JSONObject;
        expect((written["projectId"] as ObjectID).toString()).toBe(
          projectId.toString(),
        );
        expect(written["workspaceType"]).toBe(WorkspaceType.MicrosoftTeams);
        expect(written["workspaceProjectId"]).toBe(TENANT_ID);
        expect(written["authToken"]).toBe("graph-app-token");
        expect(written["authTokenExpiresAt"]).toBeInstanceOf(Date);
        expect(
          (written["authTokenExpiresAt"] as unknown as Date).getTime(),
        ).toBeGreaterThan(Date.now());
        expect(written["miscData"]).toMatchObject({
          tenantId: TENANT_ID,
          adminConsentGranted: true,
          adminConsentGrantedBy: userId.toString(),
        });
        /*
         * miscData is readable by every project Viewer, so the Graph app
         * token must only be in authToken.
         */
        expect(written["miscData"]).not.toHaveProperty("appAccessToken");
        expect(written["miscData"]).not.toHaveProperty(
          "appAccessTokenExpiresAt",
        );
        expect(JSON.stringify(written["miscData"])).not.toContain(
          "graph-app-token",
        );
      });

      test("refuses an ID token for a different tenant and binds nothing", async () => {
        const { signInState, oidcNonce, browser } =
          await completeConsentScreen();
        stubSignInTokenExchange({
          nonce: oidcNonce,
          tid: OTHER_TENANT_ID,
          iss: `https://login.microsoftonline.com/${OTHER_TENANT_ID}/v2.0`,
        });

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { code: "sign-in-code", state: signInState },
          browser,
        );

        expect(response.status).toBe(302);
        expect(response.location).toContain("error=");
        expect(response.location).toContain(
          `/${projectId.toString()}/settings/microsoft-teams-integration`,
        );

        // Only the code exchange ran; no app token was fetched for anyone.
        expect(postSpy).toHaveBeenCalledTimes(1);
        expectNothingWritten();
      });

      test.each([
        ["a different nonce", { nonce: "not-the-nonce" }],
        ["a different audience", { aud: OTHER_TENANT_ID }],
        [
          "a different issuer",
          { iss: "https://login.example.com/common/v2.0" },
        ],
        ["an expired token", { exp: Math.floor(Date.now() / 1000) - 60 }],
        ["no tenant claim", { tid: undefined }],
      ])(
        "refuses an ID token with %s",
        async (_label: string, override: JSONObject) => {
          const { signInState, oidcNonce, browser } =
            await completeConsentScreen();
          stubSignInTokenExchange({ nonce: oidcNonce, ...override });

          const response: ProbeResponse = await callback(
            ADMIN_CONSENT_CALLBACK,
            { code: "sign-in-code", state: signInState },
            browser,
          );

          expect(response.location).toContain("error=");
          expect(postSpy).toHaveBeenCalledTimes(1);
          expectNothingWritten();
        },
      );

      test("refuses when Microsoft returns no ID token", async () => {
        const { signInState, browser } = await completeConsentScreen();
        postSpy.mockImplementation(async () => {
          return new HTTPResponse<JSONObject>(
            200,
            { access_token: "user-access-token" },
            {},
          ) as any;
        });

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { code: "sign-in-code", state: signInState },
          browser,
        );

        expect(response.location).toContain("error=");
        expectNothingWritten();
      });

      test("refuses when the code exchange fails", async () => {
        const { signInState, browser } = await completeConsentScreen();
        postSpy.mockImplementation(async () => {
          return new HTTPErrorResponse(
            400,
            { error: "invalid_grant" },
            {},
          ) as any;
        });

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { code: "sign-in-code", state: signInState },
          browser,
        );

        expect(response.location).toContain("error=");
        expectNothingWritten();
      });

      test("ignores a tenant parameter on the sign-in redirect", async () => {
        const { signInState, oidcNonce, browser } =
          await completeConsentScreen();
        stubSignInTokenExchange({ nonce: oidcNonce });

        await callback(
          ADMIN_CONSENT_CALLBACK,
          {
            code: "sign-in-code",
            state: signInState,
            tenant: OTHER_TENANT_ID,
          },
          browser,
        );

        const written: JSONObject = refreshProjectAuth.mock
          .calls[0]![0] as JSONObject;
        expect(written["workspaceProjectId"]).toBe(TENANT_ID);
        for (const call of postSpy.mock.calls) {
          expect((call[0] as any).url.toString()).not.toContain(
            OTHER_TENANT_ID,
          );
        }
      });

      test("refuses a replayed sign-in state", async () => {
        const { signInState, oidcNonce, browser } =
          await completeConsentScreen();
        stubSignInTokenExchange({ nonce: oidcNonce });

        const query: Record<string, string> = {
          code: "sign-in-code",
          state: signInState,
        };

        expect(
          (await callback(ADMIN_CONSENT_CALLBACK, query, browser)).location,
        ).toContain("adminConsent=success");

        const replay: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          query,
          browser,
        );

        expect(replay.status).toBe(400);
        expect(refreshProjectAuth).toHaveBeenCalledTimes(1);
      });

      test("refuses a sign-in state completed in another browser", async () => {
        const { signInState, oidcNonce } = await completeConsentScreen();
        stubSignInTokenExchange({ nonce: oidcNonce });

        const response: ProbeResponse = await callback(ADMIN_CONSENT_CALLBACK, {
          code: "sign-in-code",
          state: signInState,
        });

        expect(response.status).toBe(400);
        expectNoTokenRequested();
        expectNothingWritten();
      });

      test("refuses an expired sign-in state", async () => {
        const { signInState, oidcNonce, browser } =
          await completeConsentScreen();
        stubSignInTokenExchange({ nonce: oidcNonce });

        const realNow: number = Date.now();
        jest
          .spyOn(Date, "now")
          .mockReturnValue(
            realNow + (WorkspaceOAuthState.EXPIRES_IN_SECONDS + 1) * 1000,
          );

        const response: ProbeResponse = await callback(
          ADMIN_CONSENT_CALLBACK,
          { code: "sign-in-code", state: signInState },
          browser,
        );

        expect(response.status).toBe(400);
        expectNoTokenRequested();
        expectNothingWritten();
      });
    });
  });

  describe("GET /microsoft-teams/sign-in-url and /microsoft-teams/auth", () => {
    test("refuses an anonymous caller", async () => {
      const response: ProbeResponse = await get(SIGN_IN_START, {
        tenantid: projectId.toString(),
      });

      expect(response.status).toBe(401);
      expect(mockCacheStore.size).toBe(0);
    });

    test("refuses a signed-in user who is not a member of the project", async () => {
      const response: ProbeResponse = await get(
        SIGN_IN_START,
        signedInHeaders({ memberOf: ObjectID.generate() }),
      );

      expect(response.status).toBe(422);
      expect(mockCacheStore.size).toBe(0);
    });

    test("lets any member sign in, with an opaque state", async () => {
      const { state, url } = await startFlow(SIGN_IN_START, {
        permissions: [Permission.Viewer],
      });

      expect(
        url.startsWith(
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?",
        ),
      ).toBe(true);
      expect(queryOf(url).get("redirect_uri")).toBe(
        `${AppApiClientUrl.toString()}/microsoft-teams/auth`,
      );
      expect(queryOf(url).get("scope")).toContain(
        "https://graph.microsoft.com/User.Read",
      );
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(url).not.toContain(projectId.toString());
    });

    test("refuses the legacy <projectId>:<userId> state and exchanges no code", async () => {
      const response: ProbeResponse = await callback(SIGN_IN_CALLBACK, {
        code: "code",
        state: `${projectId.toString()}:${userId.toString()}`,
      });

      expect(response.status).toBe(400);
      expectNoTokenRequested();
      expectNothingWritten();
    });

    test("links the Microsoft identity to the user and project that started the flow", async () => {
      const { state, browser } = await startFlow(SIGN_IN_START);

      postSpy.mockImplementation(async () => {
        return new HTTPResponse<JSONObject>(
          200,
          { access_token: "user-access-token" },
          {},
        ) as any;
      });
      getSpy.mockImplementation(async () => {
        return new HTTPResponse<JSONObject>(
          200,
          { id: "aad-user-1", displayName: "Ada", mail: "ada@example.com" },
          {},
        ) as any;
      });

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { code: "code", state },
        browser,
      );

      expect(response.status).toBe(302);
      expect(response.location).toContain(
        `/${projectId.toString()}/settings/microsoft-teams-integration`,
      );

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect((postSpy.mock.calls[0]![0] as any).data).toMatchObject({
        grant_type: "authorization_code",
        redirect_uri: `${AppApiClientUrl.toString()}/microsoft-teams/auth`,
      });

      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
      const written: JSONObject = refreshUserAuth.mock
        .calls[0]![0] as JSONObject;
      expect((written["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((written["userId"] as ObjectID).toString()).toBe(
        userId.toString(),
      );
      expect(written["workspaceUserId"]).toBe("aad-user-1");
      expect(refreshProjectAuth).not.toHaveBeenCalled();
    });

    test("refuses a replayed state", async () => {
      const { state, browser } = await startFlow(SIGN_IN_START);

      postSpy.mockImplementation(async () => {
        return new HTTPResponse<JSONObject>(
          200,
          { access_token: "user-access-token" },
          {},
        ) as any;
      });
      getSpy.mockImplementation(async () => {
        return new HTTPResponse<JSONObject>(
          200,
          { id: "aad-user-1" },
          {},
        ) as any;
      });

      await callback(SIGN_IN_CALLBACK, { code: "code", state }, browser);

      const replay: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { code: "code", state },
        browser,
      );

      expect(replay.status).toBe(400);
      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
    });

    test("refuses a state completed in a browser that did not start the flow", async () => {
      const { state } = await startFlow(SIGN_IN_START);

      const response: ProbeResponse = await callback(SIGN_IN_CALLBACK, {
        code: "code",
        state,
      });

      expect(response.status).toBe(400);
      expectNoTokenRequested();
      expectNothingWritten();
    });

    test("refuses an admin-consent state", async () => {
      const { state, browser } = await startFlow(ADMIN_CONSENT_START);

      const response: ProbeResponse = await callback(
        SIGN_IN_CALLBACK,
        { code: "code", state },
        browser,
      );

      expect(response.status).toBe(400);
      expectNoTokenRequested();
    });
  });
});
