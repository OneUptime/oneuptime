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
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import VideoCallConnectionService from "../../../Server/Services/VideoCallConnectionService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { DashboardClientUrl } from "../../../Server/EnvironmentConfig";
import IncidentCallRecordingSetting from "../../../Server/Utils/VideoCall/Transcripts/IncidentCallRecordingSetting";
import { VideoCallOAuthGrant } from "../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallOAuthApps from "../../../Server/Utils/VideoCall/OAuth/VideoCallOAuthApps";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  ConnectCallbackError,
  ConnectProvider,
} from "../../../Types/Workspace/ConnectCallback";
import FakeMicrosoftIdentityPlatform, {
  FakeAuthorizeOutcome,
  FakeSignInAudience,
} from "./FakeMicrosoftIdentityPlatform";
import {
  CacheEntry,
  cookieHeader,
  httpGet,
  ProbeResponse,
  RunningApp,
  startApp,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";

/*
 * THE ONE-CLICK CONNECT OF MICROSOFT TEAMS, WITH A SINGLE-TENANT APP, END TO END.
 *
 * An organization that allows no multitenant apps registers this server's
 * Teams meetings app for "Accounts in this organizational directory only".
 * Microsoft refuses such an app at "organizations", where the meetings
 * app signed in, with AADSTS50194 - as it refused the Teams bot's user
 * sign-in at "common" in issue #5202 - so nobody could connect Teams for
 * incident calls. MICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID names the app's
 * tenant, and the sign-in goes there.
 *
 * The whole way, with Microsoft played by FakeMicrosoftIdentityPlatform
 * (which refuses a single-tenant app at "organizations" as Microsoft does):
 *
 *   Project Settings asks GET /api/video-call-oauth/microsoft-teams/authorize-url   (real router)
 *     -> the browser at Microsoft's authorize URL                                  (the fake)
 *     -> Microsoft sends it to GET /api/video-call-oauth/microsoft-teams/callback  (real router)
 *     -> the code exchanged at the authority that issued it                        (the fake, over fetch)
 *     -> the sign-in saved as a connection                                         (a mock)
 *
 * Faked: the session middleware, Redis, the membership read, the project's
 * plan and recording setting, and the connection write.
 */

const CLIENT_ID: string = "6c1a8d3e-1111-4222-8333-944455556666";
const CLIENT_SECRET: string = "ms-meetings-secret";
const CONTOSO: string = "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11";
const FABRIKAM: string = "7f3e0c2a-0000-4000-8000-00000000aa01";

/*
 * What this server's environment says about its Teams meetings app, read
 * as each request is answered: kept inside the mock, which modules read
 * while this file's own imports load.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const teamsMeetingsApp: Record<string, string | null> = {
    MicrosoftTeamsMeetingsAppClientId: "6c1a8d3e-1111-4222-8333-944455556666",
    MicrosoftTeamsMeetingsAppClientSecret: "ms-meetings-secret",
    MicrosoftTeamsMeetingsAppTenantId: null,
  };

  return new Proxy(actual, {
    get: (target: Record<string, unknown>, key: string | symbol): unknown => {
      if (key === "__teamsMeetingsApp") {
        return teamsMeetingsApp;
      }

      if (typeof key === "string" && key in teamsMeetingsApp) {
        return teamsMeetingsApp[key];
      }

      return target[key as string];
    },
  });
});

const environment: Record<string, string | null> = (
  jest.requireMock("../../../Server/EnvironmentConfig") as Record<
    string,
    Record<string, string | null>
  >
)["__teamsMeetingsApp"]!;

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

jest.mock("../../../Server/Services/VideoCallConnectionService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      connectWithSignIn: jest.fn(),
      removeSignIn: jest.fn(),
    },
  };
});

// With billing on, as CI runs this suite, the routes read the project's plan.
jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

const ANSWER_WITHIN_MS: number = 5000;
const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;
const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

const CONNECTION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const connectWithSignIn: jest.Mock = VideoCallConnectionService.connectWithSignIn as any;
const getCurrentPlan: jest.Mock = ProjectService.getCurrentPlan as any;

const REDIRECT_URI: string = VideoCallOAuthApps.getRedirectUri(
  VideoCallProvider.MicrosoftTeams,
);

// The callback path the browser is sent back to, from the redirect URI on.
const callbackPathOf: (redirectTo: string) => string = (
  redirectTo: string,
): string => {
  const at: number = redirectTo.indexOf("/api/video-call-oauth/");

  expect(at).toBeGreaterThanOrEqual(0);

  return redirectTo.slice(at);
};

// The runtime's own fetch, if it has one, put back after each test.
const globalFetch: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(globalThis, "fetch");

describe("Microsoft Teams one-click Connect, a single-tenant app, end to end", () => {
  let app: RunningApp;
  let microsoft: FakeMicrosoftIdentityPlatform;
  let projectId: ObjectID;
  let userId: ObjectID;

  beforeAll(async () => {
    const VideoCallOAuthAPI: any = (
      await import("../../../Server/API/VideoCallOAuthAPI")
    ).default;

    app = await startApp([new VideoCallOAuthAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockCacheStore.clear();
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    microsoft = new FakeMicrosoftIdentityPlatform();
    microsoft.registerApp({
      name: "OneUptime Meetings",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      homeTenantId: CONTOSO,
      signInAudience: FakeSignInAudience.SingleTenant,
      redirectUris: [REDIRECT_URI],
    });
    microsoft.addAccount({
      person: "ada",
      tenantId: CONTOSO,
      objectId: "a0a0a0a0-0000-4000-8000-000000000001",
      displayName: "Ada Lovelace",
      mail: "ada@contoso.onmicrosoft.com",
      userPrincipalName: "ada@contoso.onmicrosoft.com",
      isGuest: false,
    });
    // A guest of Contoso from Fabrikam, and Fabrikam's own member.
    microsoft.addAccount({
      person: "grace",
      tenantId: FABRIKAM,
      objectId: "b0b0b0b0-0000-4000-8000-000000000002",
      displayName: "Grace Hopper",
      mail: "grace@fabrikam.onmicrosoft.com",
      userPrincipalName: "grace@fabrikam.onmicrosoft.com",
      isGuest: false,
    });
    microsoft.addAccount({
      person: "grace",
      tenantId: CONTOSO,
      objectId: "c0c0c0c0-0000-4000-8000-000000000003",
      displayName: "Grace Hopper",
      mail: "grace@fabrikam.onmicrosoft.com",
      userPrincipalName: "grace_fabrikam.onmicrosoft.com#EXT#@contoso.onmicrosoft.com",
      isGuest: true,
    });
    microsoft.addAccount({
      person: "mallory",
      tenantId: FABRIKAM,
      objectId: "d0d0d0d0-0000-4000-8000-000000000004",
      displayName: "Mallory",
      mail: "mallory@fabrikam.onmicrosoft.com",
      userPrincipalName: "mallory@fabrikam.onmicrosoft.com",
      isGuest: false,
    });

    environment["MicrosoftTeamsMeetingsAppTenantId"] = CONTOSO;

    /*
     * Microsoft's token endpoint, as the meetings app posts its code: with
     * the runtime's fetch, read as it sends (VideoCallHttpClient). The jest
     * environment is jsdom, which has none, so this suite lends it one for
     * each test and takes it back after.
     */
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (
        url: string,
        init?: { body?: string },
      ): Promise<unknown> => {
        return microsoft.tokenFromFetch(String(url), init?.body);
      },
    });

    getCurrentPlan.mockImplementation(async () => {
      return { plan: PlanType.Growth, isSubscriptionUnpaid: false };
    });

    connectWithSignIn.mockImplementation(async () => {
      const connection: VideoCallConnection = new VideoCallConnection();
      connection.id = CONNECTION_ID;
      return connection;
    });

    jest
      .spyOn(IncidentCallRecordingSetting, "isOn")
      .mockResolvedValue(false as never);

    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(
        async (data: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          return {
            userId: data.userId,
            tenantId: data.projectId,
            userTenantAccessPermission: {
              [data.projectId.toString()]: {
                _type: "UserTenantAccessPermission",
                projectId: data.projectId,
                permissions: [
                  {
                    _type: "UserPermission",
                    permission: Permission.ProjectAdmin,
                    labelIds: [],
                    isBlockPermission: false,
                  },
                ],
              },
            },
            userTeamIds: [],
          } as unknown as DatabaseCommonInteractionProps;
        },
      );

    jest.spyOn(UserService, "findOneById").mockImplementation(async () => {
      return { isMasterAdmin: false } as any;
    });
  });

  afterEach(() => {
    environment["MicrosoftTeamsMeetingsAppTenantId"] = null;
    jest.restoreAllMocks();

    if (globalFetch) {
      Object.defineProperty(globalThis, "fetch", globalFetch);
    } else {
      delete (globalThis as { fetch?: unknown }).fetch;
    }
  });

  function videoCallsPage(): string {
    return `${DashboardClientUrl.toString()}/${projectId.toString()}/settings/video-calls`;
  }

  // Connect pressed on the Video Calls page: the sign-in URL, and this browser's binding.
  async function startConnect(): Promise<{
    authorizationUrl: string;
    browserCookie: string;
  }> {
    const started: ProbeResponse = await httpGet({
      port: app.port,
      path: "/api/video-call-oauth/microsoft-teams/authorize-url",
      headers: {
        [TEST_USER_HEADER]: userId.toString(),
        tenantid: projectId.toString(),
        [TEST_PERMISSIONS_HEADER]: Permission.ProjectAdmin,
      } as any,
      timeoutMs: ANSWER_WITHIN_MS,
    });

    expect(started.status).toBe(200);

    return {
      authorizationUrl: (started.body as JSONObject)[
        "authorizationUrl"
      ] as string,
      browserCookie: started.setCookies[COOKIE_NAME]!,
    };
  }

  // Microsoft sends the browser back to the callback.
  async function comeBack(
    redirectTo: string,
    browserCookie: string,
  ): Promise<ProbeResponse> {
    return await httpGet({
      port: app.port,
      path: callbackPathOf(redirectTo),
      headers: {
        cookie: cookieHeader({ [COOKIE_NAME]: browserCookie }),
      },
      timeoutMs: ANSWER_WITHIN_MS,
    });
  }

  test("a member of the app's organization connects: the sign-in and the exchange go to its tenant", async () => {
    const { authorizationUrl, browserCookie } = await startConnect();

    expect(authorizationUrl).toContain(
      `https://login.microsoftonline.com/${CONTOSO}/oauth2/v2.0/authorize?`,
    );

    const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
      authorizationUrl,
      "ada",
    );

    expect(atMicrosoft.errorPage).toBeNull();

    const callback: ProbeResponse = await comeBack(
      atMicrosoft.redirectTo!,
      browserCookie,
    );

    expect(callback.status).toBe(302);
    expect(callback.location).toBe(
      `${videoCallsPage()}?provider=${ConnectProvider.MicrosoftTeamsMeetings}&connected=${CONNECTION_ID.toString()}`,
    );
    // Exchanged once, at the authority that issued the code.
    expect(microsoft.tokenRequests).toEqual([
      {
        authority: CONTOSO,
        grantType: "authorization_code",
        clientId: CLIENT_ID,
        status: 200,
      },
    ]);

    const grant: VideoCallOAuthGrant = (
      connectWithSignIn.mock.calls[0]![0] as { grant: VideoCallOAuthGrant }
    ).grant;

    expect(grant.account).toEqual({
      label: "ada@contoso.onmicrosoft.com",
      externalUserId: "a0a0a0a0-0000-4000-8000-000000000001",
      externalAccountId: CONTOSO,
    });
    expect(grant.tokens.refreshToken).toMatch(/^fake-refresh-token-/);
  });

  test("a guest of the app's organization connects as the guest account it holds", async () => {
    const { authorizationUrl, browserCookie } = await startConnect();
    const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
      authorizationUrl,
      "grace",
    );

    const callback: ProbeResponse = await comeBack(
      atMicrosoft.redirectTo!,
      browserCookie,
    );

    expect(callback.location).toContain("&connected=");

    const grant: VideoCallOAuthGrant = (
      connectWithSignIn.mock.calls[0]![0] as { grant: VideoCallOAuthGrant }
    ).grant;

    expect(grant.account.externalUserId).toBe(
      "c0c0c0c0-0000-4000-8000-000000000003",
    );
    expect(grant.account.externalAccountId).toBe(CONTOSO);
  });

  test("somebody of another organization is stopped on Microsoft's own page, and nothing is connected", async () => {
    const { authorizationUrl } = await startConnect();
    const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
      authorizationUrl,
      "mallory",
    );

    expect(atMicrosoft).toEqual({ redirectTo: null, errorPage: "AADSTS50020" });
    expect(microsoft.tokenRequests).toEqual([]);
    expect(connectWithSignIn).not.toHaveBeenCalled();
  });

  test("without the tenant set, the same app is refused at organizations with AADSTS50194, and nobody connects", async () => {
    environment["MicrosoftTeamsMeetingsAppTenantId"] = null;

    const { authorizationUrl, browserCookie } = await startConnect();

    expect(authorizationUrl).toContain(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?",
    );

    const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
      authorizationUrl,
      "ada",
    );
    const back: URLSearchParams = new URLSearchParams(
      atMicrosoft.redirectTo!.split("?")[1],
    );

    expect(back.get("error")).toBe("invalid_request");
    expect(back.get("error_description")).toContain(
      "AADSTS50194: Application '6c1a8d3e-1111-4222-8333-944455556666'(OneUptime Meetings) is not configured as a multi-tenant application.",
    );

    const callback: ProbeResponse = await comeBack(
      atMicrosoft.redirectTo!,
      browserCookie,
    );

    expect(callback.status).toBe(302);
    expect(callback.location).toBe(
      `${videoCallsPage()}?provider=${ConnectProvider.MicrosoftTeamsMeetings}&error=${ConnectCallbackError.CouldNotFinish}`,
    );
    expect(callback.location).not.toContain("AADSTS");
    expect(microsoft.tokenRequests).toEqual([]);
    expect(connectWithSignIn).not.toHaveBeenCalled();
  });

  test("a multitenant app with no tenant set still signs in at organizations, as before", async () => {
    environment["MicrosoftTeamsMeetingsAppTenantId"] = null;
    microsoft.registerApp({
      name: "OneUptime Meetings",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      homeTenantId: CONTOSO,
      signInAudience: FakeSignInAudience.MultiTenant,
      redirectUris: [REDIRECT_URI],
    });

    const { authorizationUrl, browserCookie } = await startConnect();
    const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
      authorizationUrl,
      "mallory",
    );

    const callback: ProbeResponse = await comeBack(
      atMicrosoft.redirectTo!,
      browserCookie,
    );

    expect(callback.location).toContain("&connected=");
    expect(microsoft.tokenRequests[0]!.authority).toBe("organizations");
  });
});
