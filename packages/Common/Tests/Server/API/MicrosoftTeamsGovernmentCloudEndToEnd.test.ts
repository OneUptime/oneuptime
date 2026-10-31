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

/*
 * MICROSOFT TEAMS IN A US GOVERNMENT CLOUD, END TO END: CONNECTING A PROJECT
 * AND AN ACCOUNT IN GCC HIGH AND DOD.
 *
 * A GCC High or DoD tenant lives in Azure Government: its sign-in is
 * login.microsoftonline.us, its Graph graph.microsoft.us (dod-graph for
 * DoD), and the commercial cloud's hosts know neither its apps nor its
 * tokens. OneUptime wrote every one of those addresses as the commercial
 * cloud's, so a government customer could not even grant admin consent.
 * With MICROSOFT_TEAMS_CLOUD set to gcc-high or dod, every request goes to
 * that cloud's hosts.
 *
 * The whole way through the real routes, with Microsoft played by a
 * FakeMicrosoftIdentityPlatform made for the government cloud - which, as
 * Microsoft does, answers on that cloud's hosts only and takes scopes on
 * that cloud's Graph only:
 *
 *   Grant Admin Consent: GET /api/microsoft-teams/admin-consent      (real router)
 *     -> the admin at Microsoft's admin consent page                 (the fake)
 *     -> back at the callback, sent on to sign in to the tenant      (real router)
 *     -> the sign-in, back at the callback                           (the fake, the router)
 *     -> the code exchanged, the ID token's issuer checked, the app
 *        token got and the tenant's teams read                       (the fake)
 *     -> the project bound to the tenant                             (a mock)
 *   Connect my account: GET /api/microsoft-teams/sign-in-url        (real router)
 *     -> signed in, the code exchanged, /me read, the account linked
 *
 * And without the setting, the same tenant is refused by the commercial
 * cloud (as it always was), and a setting that names no cloud sends
 * nothing anywhere.
 */

const CLIENT_ID: string = "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80";
const CLIENT_SECRET: string = "teams-client-secret";
// An agency's tenant in Azure Government; the app is registered in it.
const AGENCY: string = "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/*
 * The app's tenant and the cloud differ per case, so both are getters over
 * state the test sets (the routes read them as properties of this module
 * each time).
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const settings: { cloud: string | null; appTenantId: string | null } = {
    cloud: null,
    appTenantId: null,
  };

  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80",
    MicrosoftTeamsAppClientSecret: "teams-client-secret",
    setMockTeamsSettings: (next: {
      cloud: string | null;
      appTenantId: string | null;
    }): void => {
      settings.cloud = next.cloud;
      settings.appTenantId = next.appTenantId;
    },
  };

  Object.defineProperty(mocked, "MicrosoftTeamsCloudSetting", {
    configurable: true,
    enumerable: true,
    get: (): string | null => {
      return settings.cloud;
    },
  });
  Object.defineProperty(mocked, "MicrosoftTeamsAppTenantId", {
    configurable: true,
    enumerable: true,
    get: (): string | null => {
      return settings.appTenantId;
    },
  });

  return mocked;
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

jest.mock("../../../Server/Utils/Logger");

import API from "../../../Utils/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { MicrosoftTeamsCloud } from "../../../Types/Workspace/MicrosoftTeamsCloud";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";
import {
  AppApiClientUrl,
  DashboardClientUrl,
} from "../../../Server/EnvironmentConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
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

const ADMIN_CONSENT_START: string = "/api/microsoft-teams/admin-consent";
const ADMIN_CONSENT_CALLBACK: string =
  "/api/microsoft-teams/admin-consent/callback";
const SIGN_IN_START: string = "/api/microsoft-teams/sign-in-url";
const SIGN_IN_CALLBACK: string = "/api/microsoft-teams/auth";
const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;

const REDIRECT_URIS: Array<string> = [
  `${AppApiClientUrl.toString()}/microsoft-teams/auth`,
  `${AppApiClientUrl.toString()}/microsoft-teams/admin-consent/callback`,
];

const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

type Browser = Record<string, string>;

function setTeams(settings: {
  cloud: string | null;
  appTenantId: string | null;
}): void {
  (
    jest.requireMock("../../../Server/EnvironmentConfig") as {
      setMockTeamsSettings: (next: {
        cloud: string | null;
        appTenantId: string | null;
      }) => void;
    }
  ).setMockTeamsSettings(settings);
}

/*
 * A URL OneUptime or the fake wrote, split at its query - never parsed as a
 * whole: a test server's URLs may have no host (HOST is unset outside CI).
 */
function splitUrl(url: string): { address: string; query: URLSearchParams } {
  const at: number = url.indexOf("?");

  return at < 0
    ? { address: url, query: new URLSearchParams() }
    : {
        address: url.substring(0, at),
        query: new URLSearchParams(url.substring(at + 1)),
      };
}

// ---- Per test ----

let app: RunningApp;
let microsoft: FakeMicrosoftIdentityPlatform;
let projectId: ObjectID;
let userId: ObjectID;
let connectedTenantId: string | null = null;

// What the routes wrote: the project's binding, the account's link.
let projectWrites: Array<JSONObject> = [];
let accountLinks: Array<JSONObject> = [];

function connection(): WorkspaceProjectAuthToken | null {
  if (!connectedTenantId) {
    return null;
  }

  const row: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  row.projectId = projectId;
  row.workspaceType = WorkspaceType.MicrosoftTeams;
  row.workspaceProjectId = connectedTenantId;
  row.miscData = {
    tenantId: connectedTenantId,
    adminConsentGranted: true,
    availableTeams: {},
  } as unknown as NonNullable<WorkspaceProjectAuthToken["miscData"]>;
  return row;
}

function adminHeaders(): Record<string, string> {
  return {
    [TEST_USER_HEADER]: userId.toString(),
    tenantid: projectId.toString(),
    [TEST_PERMISSIONS_HEADER]: Permission.ProjectAdmin,
  };
}

async function startAt(
  path: string,
): Promise<{ authorizationUrl: string; browser: Browser; status: number }> {
  const response: ProbeResponse = await httpGet({
    port: app.port,
    path: path,
    headers: adminHeaders(),
  });

  return {
    status: response.status,
    authorizationUrl: String(
      ((response.body || {}) as JSONObject)["authorizationUrl"] || "",
    ),
    browser: { [COOKIE_NAME]: response.setCookies[COOKIE_NAME] || "" },
  };
}

// Microsoft sends the browser back to one of OneUptime's callbacks.
function comeBack(
  redirectTo: string,
  callbackPath: string,
  browser: Browser,
): Promise<ProbeResponse> {
  const target: { address: string; query: URLSearchParams } =
    splitUrl(redirectTo);

  expect(REDIRECT_URIS).toContain(target.address);

  return httpGet({
    port: app.port,
    path: `${callbackPath}?${target.query.toString()}`,
    headers: { cookie: cookieHeader(browser) },
  });
}

interface ConsentRun {
  consentUrl: string;
  atConsent: FakeAuthorizeOutcome;
  signInUrl: string | null;
  done: ProbeResponse | null;
}

// Grant Admin Consent, all the way, as `person`.
async function grantAdminConsent(person: string): Promise<ConsentRun> {
  const started: { authorizationUrl: string; browser: Browser } =
    await startAt(ADMIN_CONSENT_START);
  const atConsent: FakeAuthorizeOutcome = microsoft.adminConsent(
    started.authorizationUrl,
    person,
  );

  if (!atConsent.redirectTo) {
    return {
      consentUrl: started.authorizationUrl,
      atConsent,
      signInUrl: null,
      done: null,
    };
  }

  const leg1: ProbeResponse = await comeBack(
    atConsent.redirectTo,
    ADMIN_CONSENT_CALLBACK,
    started.browser,
  );

  expect(leg1.status).toBe(302);

  const signInUrl: string = leg1.location || "";

  if (splitUrl(signInUrl).address.startsWith(DashboardClientUrl.toString())) {
    // Sent back to the Dashboard: the consent did not go through.
    return {
      consentUrl: started.authorizationUrl,
      atConsent,
      signInUrl: null,
      done: leg1,
    };
  }

  const atSignIn: FakeAuthorizeOutcome = microsoft.authorize(signInUrl, person);

  expect(atSignIn.errorPage).toBeNull();

  return {
    consentUrl: started.authorizationUrl,
    atConsent,
    signInUrl,
    done: await comeBack(
      atSignIn.redirectTo!,
      ADMIN_CONSENT_CALLBACK,
      started.browser,
    ),
  };
}

// "Connect my account with Microsoft Teams", as `person`.
async function connectAccount(person: string): Promise<{
  authorizationUrl: string;
  callback: ProbeResponse | null;
}> {
  const started: { authorizationUrl: string; browser: Browser } =
    await startAt(SIGN_IN_START);
  const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
    started.authorizationUrl,
    person,
  );

  return {
    authorizationUrl: started.authorizationUrl,
    callback: atMicrosoft.redirectTo
      ? await comeBack(atMicrosoft.redirectTo, SIGN_IN_CALLBACK, started.browser)
      : null,
  };
}

function teamsPage(): string {
  return `${DashboardClientUrl.toString()}/${projectId.toString()}/settings/microsoft-teams-integration`;
}

// The origins of every address OneUptime called at Microsoft.
function calledOrigins(): Array<string> {
  return Array.from(
    new Set(
      microsoft.calledUrls.map((url: string): string => {
        return new globalThis.URL(url).origin;
      }),
    ),
  ).sort();
}

const PEOPLE: Array<{ cloud: MicrosoftTeamsCloud; setting: string }> = [
  { cloud: MicrosoftTeamsCloud.GccHigh, setting: "gcc-high" },
  { cloud: MicrosoftTeamsCloud.DoD, setting: "dod" },
];

function makeMicrosoft(cloud: MicrosoftTeamsCloud): void {
  microsoft = new FakeMicrosoftIdentityPlatform({ cloud: cloud });
  microsoft.registerApp({
    name: "OneUptime",
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    homeTenantId: AGENCY,
    signInAudience: FakeSignInAudience.SingleTenant,
    redirectUris: REDIRECT_URIS,
  });
  microsoft.addAccount({
    person: "ada",
    tenantId: AGENCY,
    objectId: "a0a0a0a0-0000-4000-8000-000000000001",
    displayName: "Ada Lovelace",
    mail: "ada@agency.example.gov",
    userPrincipalName: "ada@agency.example.gov",
    isGuest: false,
  });
  microsoft.addTeam(AGENCY, {
    id: "6d0e0f10-0000-4000-8000-0000000000a1",
    displayName: "Operations",
  });
}

beforeAll(async () => {
  app = await startApp([new MicrosoftTeamsAPI().getRouter()]);
}, 600000);

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockCacheStore.clear();
  projectId = ObjectID.generate();
  userId = ObjectID.generate();
  connectedTenantId = null;
  projectWrites = [];
  accountLinks = [];
  makeMicrosoft(MicrosoftTeamsCloud.GccHigh);
  setTeams({ cloud: "gcc-high", appTenantId: AGENCY });

  // Every request to Microsoft goes to the fake.
  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    return microsoft.token(options.url.toString(), options.data);
  }) as never);
  jest.spyOn(API, "get").mockImplementation((async (options: {
    url: URL;
    headers?: Record<string, string>;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    return microsoft.graph(options.url.toString(), options.headers);
  }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation(async () => {
      return connection();
    });
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "refreshAuthToken")
    .mockImplementation((async (data: JSONObject) => {
      projectWrites.push(data);
      connectedTenantId = String(data["workspaceProjectId"]);
    }) as never);
  jest
    .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
    .mockResolvedValue(null as never);
  jest
    .spyOn(WorkspaceUserAuthTokenService, "refreshAuthToken")
    .mockImplementation((async (data: JSONObject) => {
      accountLinks.push(data);
    }) as never);

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
  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    return { isMasterAdmin: false };
  }) as never);
  jest.spyOn(ProjectService, "getCurrentPlan").mockImplementation((async () => {
    return { plan: null, isSubscriptionUnpaid: false };
  }) as never);
  jest
    .spyOn(MicrosoftTeamsUtil, "refreshTeams")
    .mockImplementation((async () => {
      return {};
    }) as never);
});

afterEach(() => {
  setTeams({ cloud: null, appTenantId: null });
  jest.restoreAllMocks();
});

// ---- Tests ----

describe.each(PEOPLE)(
  "a server in $setting, its app and tenant in Azure Government",
  ({ cloud, setting }: { cloud: MicrosoftTeamsCloud; setting: string }) => {
    beforeEach(() => {
      makeMicrosoft(cloud);
      setTeams({ cloud: setting, appTenantId: AGENCY });
    });

    test("Grant Admin Consent goes to Azure Government's sign-in, for its Graph", async () => {
      const started: { authorizationUrl: string } =
        await startAt(ADMIN_CONSENT_START);
      const consent: { address: string; query: URLSearchParams } = splitUrl(
        started.authorizationUrl,
      );

      expect(consent.address).toBe(
        "https://login.microsoftonline.us/organizations/v2.0/adminconsent",
      );
      expect(consent.query.get("scope")).toBe(
        `${microsoft.hosts.graphOrigin}/.default`,
      );
      expect(consent.query.get("client_id")).toBe(CLIENT_ID);
    });

    test("consent, the tenant sign-in and the Graph reads all happen in that cloud, and the project is bound to the agency's tenant", async () => {
      const run: ConsentRun = await grantAdminConsent("ada");

      expect(run.atConsent.errorPage).toBeNull();
      expect(splitUrl(run.signInUrl!).address).toBe(
        `https://login.microsoftonline.us/${AGENCY}/oauth2/v2.0/authorize`,
      );

      expect(run.done!.status).toBe(302);
      expect(run.done!.location).toContain(teamsPage());
      expect(run.done!.location).toContain("adminConsent=success");

      // The ID token's issuer is Azure Government's, and was taken.
      expect(projectWrites).toHaveLength(1);
      expect(projectWrites[0]!["workspaceProjectId"]).toBe(AGENCY);
      expect(projectWrites[0]!["miscData"]).toMatchObject({
        tenantId: AGENCY,
        adminConsentGranted: true,
        availableTeams: {
          "6d0e0f10-0000-4000-8000-0000000000a1": {
            id: "6d0e0f10-0000-4000-8000-0000000000a1",
            name: "Operations",
          },
        },
      });

      // The code, then the app token, at the agency's tenant, in Azure Government.
      expect(
        microsoft.tokenRequests.map((request: { grantType: string }) => {
          return request.grantType;
        }),
      ).toEqual(["authorization_code", "client_credentials"]);
      expect(calledOrigins()).toEqual(
        [microsoft.hosts.graphOrigin, "https://login.microsoftonline.us"].sort(),
      );
    });

    test("Connect my account signs in at the agency's tenant, asks for that cloud's Graph, and links the account", async () => {
      connectedTenantId = AGENCY;

      const connected: {
        authorizationUrl: string;
        callback: ProbeResponse | null;
      } = await connectAccount("ada");
      const signIn: { address: string; query: URLSearchParams } = splitUrl(
        connected.authorizationUrl,
      );

      expect(signIn.address).toBe(
        `https://login.microsoftonline.us/${AGENCY}/oauth2/v2.0/authorize`,
      );
      expect((signIn.query.get("scope") || "").split(" ")).toEqual([
        `${microsoft.hosts.graphOrigin}/User.Read`,
        `${microsoft.hosts.graphOrigin}/Team.ReadBasic.All`,
        `${microsoft.hosts.graphOrigin}/Channel.ReadBasic.All`,
        `${microsoft.hosts.graphOrigin}/ChannelMessage.Send`,
      ]);

      expect(connected.callback!.status).toBe(302);
      expect(connected.callback!.location).not.toContain("error=");
      expect(microsoft.profileReads).toHaveLength(1);
      expect(accountLinks).toHaveLength(1);
      expect(accountLinks[0]!["workspaceUserId"]).toBe(
        "a0a0a0a0-0000-4000-8000-000000000001",
      );
      expect(calledOrigins()).toEqual(
        [microsoft.hosts.graphOrigin, "https://login.microsoftonline.us"].sort(),
      );
    });
  },
);

describe("the same agency, without MICROSOFT_TEAMS_CLOUD: why the setting is needed", () => {
  test("admin consent goes to the commercial cloud, which knows neither the app nor the tenant, and nothing is bound", async () => {
    setTeams({ cloud: null, appTenantId: AGENCY });

    const run: ConsentRun = await grantAdminConsent("ada");

    expect(splitUrl(run.consentUrl).address).toBe(
      "https://login.microsoftonline.com/organizations/v2.0/adminconsent",
    );
    // Stopped on Microsoft's own page: AADSTS700016.
    expect(run.atConsent).toEqual({
      redirectTo: null,
      errorPage: "AADSTS700016",
    });
    expect(projectWrites).toEqual([]);
    expect(microsoft.tokenRequests).toEqual([]);
  });

  test("a sign-in at the commercial cloud is refused the same way, and no account is linked", async () => {
    setTeams({ cloud: null, appTenantId: AGENCY });
    connectedTenantId = AGENCY;

    const connected: {
      authorizationUrl: string;
      callback: ProbeResponse | null;
    } = await connectAccount("ada");

    expect(splitUrl(connected.authorizationUrl).address).toBe(
      `https://login.microsoftonline.com/${AGENCY}/oauth2/v2.0/authorize`,
    );
    expect(connected.callback).toBeNull();
    expect(accountLinks).toEqual([]);
  });
});

describe("a MICROSOFT_TEAMS_CLOUD that names no cloud", () => {
  test("Grant Admin Consent and Connect my account send nobody anywhere, and nothing is asked of Microsoft", async () => {
    setTeams({ cloud: "usgov", appTenantId: AGENCY });
    connectedTenantId = AGENCY;

    for (const path of [ADMIN_CONSENT_START, SIGN_IN_START]) {
      const started: { authorizationUrl: string; status: number } =
        await startAt(path);

      expect(started.status).toBeGreaterThanOrEqual(400);
      expect(started.authorizationUrl).toBe("");
    }

    expect(microsoft.calledUrls).toEqual([]);
    expect(projectWrites).toEqual([]);
    expect(accountLinks).toEqual([]);
  });

  test("the bot check names the setting and the values it takes", async () => {
    setTeams({ cloud: "usgov", appTenantId: AGENCY });

    const response: ProbeResponse = await httpGet({
      port: app.port,
      path: "/api/microsoft-bot/test",
    });

    expect((response.body as JSONObject)["error"]).toBe(
      'MICROSOFT_TEAMS_CLOUD is "usgov", which names no Microsoft cloud. Set it to commercial, gcc, gcc-high, dod, or leave it unset for the commercial cloud.',
    );
  });
});

describe("the bot check, in each cloud", () => {
  test.each([
    [null, "Commercial", "https://login.microsoftonline.com", "https://graph.microsoft.com", "Azure public cloud (the Bot Framework's default)"],
    ["gcc", "GCC", "https://login.microsoftonline.com", "https://graph.microsoft.com", "Azure public cloud (the Bot Framework's default)"],
    ["gcc-high", "GCC High", "https://login.microsoftonline.us", "https://graph.microsoft.us", "https://botframework.azure.us"],
    ["dod", "DoD", "https://login.microsoftonline.us", "https://dod-graph.microsoft.us", "https://botframework.azure.us"],
  ])(
    "%s: says which cloud, and its hosts",
    async (
      setting: string | null,
      title: string,
      signIn: string,
      graph: string,
      botFrameworkChannel: string,
    ) => {
      setTeams({ cloud: setting, appTenantId: AGENCY });

      const response: ProbeResponse = await httpGet({
        port: app.port,
        path: "/api/microsoft-bot/test",
      });
      const body: JSONObject = response.body as JSONObject;

      expect(body["error"]).toBeUndefined();
      expect(body["cloud"]).toBe(title);
      expect(body["hosts"]).toEqual({
        signIn: signIn,
        graph: graph,
        botFrameworkChannel: botFrameworkChannel,
      });
      expect(body["verified"]).toContain(
        `MICROSOFT_TEAMS_CLOUD names a Microsoft cloud: ${title}`,
      );
    },
  );
});
