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
 * A PROJECT CONNECTED TO SOMEBODY ELSE'S MICROSOFT 365 ORGANIZATION, END TO
 * END (Microsoft Teams store certification, ticket 5877223).
 *
 * Microsoft's store reviewers test the OneUptime app with a test account
 * OneUptime gives them, each in a Microsoft 365 test tenant of their own -
 * and every one of those is called "Contoso". The test project had been
 * connected to one reviewer's Contoso. The next reviewer opened its
 * Microsoft Teams settings, connected "our own Microsoft 365 test tenant
 * using the tenant admin account", and Microsoft stopped them on its own
 * page: "Selected user account does not exist in tenant 'Contoso' and
 * cannot access the application ... in that tenant" (AADSTS50020). Every
 * sign-in for a connected project goes to its organization, by design
 * (MicrosoftTeamsSignInAuthority), and Microsoft never sends such a browser
 * back, so OneUptime could not explain it. The settings page said
 * "Consent is granted for your Microsoft 365 organization" - not whose.
 *
 * Now admin consent keeps the organization's name and domain (read from
 * Microsoft Graph's /organization with the admin's own token), the page
 * names the organization, and a project admin can connect a different
 * organization: the connection is removed, and consent goes to any
 * organization again. Two reviewers' "Contoso"s, told apart by domain:
 *
 *   Grant Admin Consent: GET /api/microsoft-teams/admin-consent      (real router)
 *     -> the admin at Microsoft's admin consent page                 (the fake)
 *     -> back at the callback, sent on to sign in to the tenant      (real router)
 *     -> the sign-in; the code exchanged, the ID token checked,
 *        /organization read, the app token got, the teams read       (the fake)
 *     -> the project bound to the tenant, named                      (a mock)
 *   Connect my account: GET /api/microsoft-teams/sign-in-url        (real router)
 *     -> signed in at the project's organization, or stopped there
 */

const CLIENT_ID: string = "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80";
const CLIENT_SECRET: string = "teams-client-secret";

// Where OneUptime Cloud's multitenant app is registered.
const ONEUPTIME_CLOUD: string = "4220aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
// The first reviewer's test tenant.
const FIRST_CONTOSO: string = "1c0f7a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
// The next reviewer's: another tenant, with the same display name.
const SECOND_CONTOSO: string = "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918";

const FIRST_DOMAIN: string = "m365x11111111.onmicrosoft.com";
const SECOND_DOMAIN: string = "m365x22222222.onmicrosoft.com";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80",
    MicrosoftTeamsAppClientSecret: "teams-client-secret",
    // OneUptime Cloud names no tenant of its own for sign-ins.
    MicrosoftTeamsAppTenantId: null,
    MicrosoftTeamsCloudSetting: null,
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

jest.mock("../../../Server/Utils/Logger");

import API from "../../../Utils/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
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
  FakeAccount,
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

// Each reviewer is the admin of their own test tenant, and nobody else's.
const FIRST_REVIEWER: FakeAccount = {
  person: "first-reviewer",
  tenantId: FIRST_CONTOSO,
  objectId: "a1a1a1a1-0000-4000-8000-000000000001",
  displayName: "MOD Administrator",
  mail: `admin@${FIRST_DOMAIN}`,
  userPrincipalName: `admin@${FIRST_DOMAIN}`,
  isGuest: false,
};

const SECOND_REVIEWER: FakeAccount = {
  person: "second-reviewer",
  tenantId: SECOND_CONTOSO,
  objectId: "b2b2b2b2-0000-4000-8000-000000000002",
  displayName: "MOD Administrator",
  mail: `admin@${SECOND_DOMAIN}`,
  userPrincipalName: `admin@${SECOND_DOMAIN}`,
  isGuest: false,
};

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

// The authority a Microsoft URL names: a tenant id, or "organizations".
function authorityOf(url: string): string {
  return decodeURIComponent(
    new globalThis.URL(url).pathname.split("/")[1] || "",
  ).toLowerCase();
}

// ---- Per test ----

let app: RunningApp;
let microsoft: FakeMicrosoftIdentityPlatform;
let projectId: ObjectID;
let userId: ObjectID;

// The project's Microsoft Teams connection, as the routes last wrote it.
let connectedTenantId: string | null = null;
let connectedMiscData: JSONObject | null = null;

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
  row.miscData = (connectedMiscData || {
    tenantId: connectedTenantId,
    adminConsentGranted: true,
    availableTeams: {},
  }) as unknown as NonNullable<WorkspaceProjectAuthToken["miscData"]>;
  return row;
}

/*
 * What Connect a Different Organization does first, on the Dashboard: the
 * project's connection is deleted, as Uninstall deletes it.
 */
function disconnectProject(): void {
  connectedTenantId = null;
  connectedMiscData = null;
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
): Promise<{ authorizationUrl: string; browser: Browser }> {
  const response: ProbeResponse = await httpGet({
    port: app.port,
    path: path,
    headers: adminHeaders(),
  });

  expect(response.status).toBe(200);

  return {
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
  atMicrosoft: FakeAuthorizeOutcome;
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
    atMicrosoft,
    callback: atMicrosoft.redirectTo
      ? await comeBack(
          atMicrosoft.redirectTo,
          SIGN_IN_CALLBACK,
          started.browser,
        )
      : null,
  };
}

function teamsPage(): string {
  return `${DashboardClientUrl.toString()}/${projectId.toString()}/settings/microsoft-teams-integration`;
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
  connectedMiscData = null;
  projectWrites = [];
  accountLinks = [];

  microsoft = new FakeMicrosoftIdentityPlatform();
  microsoft.registerApp({
    name: "OneUptime",
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    homeTenantId: ONEUPTIME_CLOUD,
    signInAudience: FakeSignInAudience.MultiTenant,
    redirectUris: REDIRECT_URIS,
  });
  microsoft.addAccount(FIRST_REVIEWER);
  microsoft.addAccount(SECOND_REVIEWER);

  // Every Microsoft 365 developer tenant is called Contoso.
  microsoft.addOrganization(FIRST_CONTOSO, {
    displayName: "Contoso",
    verifiedDomains: [{ name: FIRST_DOMAIN, isDefault: true, isInitial: true }],
  });
  microsoft.addOrganization(SECOND_CONTOSO, {
    displayName: "Contoso",
    verifiedDomains: [
      { name: SECOND_DOMAIN, isDefault: true, isInitial: true },
    ],
  });

  for (const tenant of [FIRST_CONTOSO, SECOND_CONTOSO]) {
    microsoft.addTeam(tenant, {
      id: `${tenant.substring(0, 8)}-0000-4000-8000-0000000000a1`,
      displayName: "Mark 8 Project Team",
    });
  }

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
      connectedMiscData = data["miscData"] as JSONObject;
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
  jest.restoreAllMocks();
});

// Graph refuses to read the organization; everything else is answered as the fake does.
function organizationReadFails(): void {
  const fake: FakeMicrosoftIdentityPlatform = microsoft;

  jest.spyOn(fake, "graph").mockImplementation(((
    url: string,
    headers: Record<string, string> | undefined,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse => {
    if (new globalThis.URL(url).pathname === "/v1.0/organization") {
      return new HTTPErrorResponse(
        503,
        { error: { code: "serviceNotAvailable" } },
        {},
      );
    }

    return FakeMicrosoftIdentityPlatform.prototype.graph.call(
      fake,
      url,
      headers,
    );
  }) as never);
}

// ---- Tests ----

describe("Grant Admin Consent keeps the organization's name, so the page can say which it is", () => {
  test("the first reviewer connects their Contoso: the project is bound to it, by its name and its domain", async () => {
    const run: ConsentRun = await grantAdminConsent("first-reviewer");

    // Nothing named a tenant yet: consent goes to any organization.
    expect(authorityOf(run.consentUrl)).toBe("organizations");

    // The tenant sign-in asks for an ID token, and User.Read to read the organization.
    expect(authorityOf(run.signInUrl!)).toBe(FIRST_CONTOSO);
    expect(
      (splitUrl(run.signInUrl!).query.get("scope") || "").split(" "),
    ).toEqual(["openid", "profile", "https://graph.microsoft.com/User.Read"]);

    expect(run.done!.status).toBe(302);
    expect(run.done!.location).toContain(teamsPage());
    expect(run.done!.location).toContain("adminConsent=success");

    expect(projectWrites).toHaveLength(1);
    expect(projectWrites[0]!["workspaceProjectId"]).toBe(FIRST_CONTOSO);
    expect(projectWrites[0]!["miscData"]).toMatchObject({
      tenantId: FIRST_CONTOSO,
      organizationName: "Contoso",
      organizationDomain: FIRST_DOMAIN,
      adminConsentGranted: true,
    });

    // Read with the admin's own token: the app's has no permission for it.
    expect(microsoft.organizationReads).toEqual([FIRST_REVIEWER]);
  });

  test("an organization Graph does not name is still connected, with nothing kept but its tenant", async () => {
    organizationReadFails();

    const run: ConsentRun = await grantAdminConsent("first-reviewer");

    expect(run.done!.location).toContain("adminConsent=success");
    expect(projectWrites).toHaveLength(1);
    expect(projectWrites[0]!["workspaceProjectId"]).toBe(FIRST_CONTOSO);
    expect(projectWrites[0]!["miscData"]).not.toHaveProperty(
      "organizationName",
    );
    expect(projectWrites[0]!["miscData"]).not.toHaveProperty(
      "organizationDomain",
    );
  });

  test("consent granted again for the same organization keeps its name when Graph does not say this time", async () => {
    await grantAdminConsent("first-reviewer");

    organizationReadFails();

    // Reset Admin Consent: consent again, pinned to the project's own organization.
    const again: ConsentRun = await grantAdminConsent("first-reviewer");

    expect(authorityOf(again.consentUrl)).toBe(FIRST_CONTOSO);
    expect(projectWrites).toHaveLength(2);
    expect(projectWrites[1]!["miscData"]).toMatchObject({
      tenantId: FIRST_CONTOSO,
      organizationName: "Contoso",
      organizationDomain: FIRST_DOMAIN,
    });
  });
});

describe("the next reviewer, at the project connected to the first reviewer's Contoso", () => {
  beforeEach(async () => {
    await grantAdminConsent("first-reviewer");
    projectWrites = [];
  });

  test("Connect my account goes to the first reviewer's Contoso, where Microsoft stops them on its own page and never sends them back", async () => {
    const connected: {
      authorizationUrl: string;
      atMicrosoft: FakeAuthorizeOutcome;
      callback: ProbeResponse | null;
    } = await connectAccount("second-reviewer");

    expect(authorityOf(connected.authorizationUrl)).toBe(FIRST_CONTOSO);
    // "Selected user account does not exist in tenant 'Contoso'..."
    expect(connected.atMicrosoft.errorPage).toBe("AADSTS50020");
    expect(connected.callback).toBeNull();
    expect(accountLinks).toEqual([]);
  });

  test("Grant Admin Consent again (Reset Admin Consent) is pinned there too: stopped the same way, and nothing changes", async () => {
    const run: ConsentRun = await grantAdminConsent("second-reviewer");

    expect(authorityOf(run.consentUrl)).toBe(FIRST_CONTOSO);
    expect(run.atConsent.errorPage).toBe("AADSTS50020");
    expect(projectWrites).toEqual([]);
    expect(connectedTenantId).toBe(FIRST_CONTOSO);
  });

  test("what the page names the connection by tells the two Contosos apart: the same name, another domain", () => {
    expect(connection()!.miscData).toMatchObject({
      organizationName: "Contoso",
      organizationDomain: FIRST_DOMAIN,
    });
    expect(FIRST_DOMAIN).not.toBe(SECOND_DOMAIN);
  });

  test("Connect a Different Organization: once the connection is removed, consent goes to any organization, the project is bound to the next reviewer's Contoso, and their account connects", async () => {
    disconnectProject();

    const run: ConsentRun = await grantAdminConsent("second-reviewer");

    expect(authorityOf(run.consentUrl)).toBe("organizations");
    expect(run.atConsent.errorPage).toBeNull();
    expect(run.done!.location).toContain("adminConsent=success");
    expect(connectedTenantId).toBe(SECOND_CONTOSO);
    expect(projectWrites).toHaveLength(1);
    expect(projectWrites[0]!["miscData"]).toMatchObject({
      tenantId: SECOND_CONTOSO,
      organizationName: "Contoso",
      organizationDomain: SECOND_DOMAIN,
    });

    const connected: {
      authorizationUrl: string;
      atMicrosoft: FakeAuthorizeOutcome;
      callback: ProbeResponse | null;
    } = await connectAccount("second-reviewer");

    expect(authorityOf(connected.authorizationUrl)).toBe(SECOND_CONTOSO);
    expect(connected.atMicrosoft.errorPage).toBeNull();
    expect(connected.callback!.status).toBe(302);
    expect(connected.callback!.location).not.toContain("error=");
    expect(accountLinks).toHaveLength(1);
    expect(accountLinks[0]!["workspaceUserId"]).toBe(SECOND_REVIEWER.objectId);
  });

  test("and the first reviewer, at the project now connected to the next one's Contoso, is the one Microsoft stops", async () => {
    disconnectProject();
    await grantAdminConsent("second-reviewer");

    const connected: {
      authorizationUrl: string;
      atMicrosoft: FakeAuthorizeOutcome;
      callback: ProbeResponse | null;
    } = await connectAccount("first-reviewer");

    expect(authorityOf(connected.authorizationUrl)).toBe(SECOND_CONTOSO);
    expect(connected.atMicrosoft.errorPage).toBe("AADSTS50020");
    expect(accountLinks).toEqual([]);
  });
});
