import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import http from "http";
import type { AddressInfo } from "net";

/*
 * ISSUE #5202, END TO END: CONNECTING A MICROSOFT TEAMS ACCOUNT WITH THE APP
 * THE SELF-HOSTED GUIDE ASKS FOR.
 *
 * The guide registers the Microsoft Teams app for one organization (single
 * tenant). Admin consent worked - it signs in at the tenant - but "Connect my
 * account with Microsoft Teams", and the Connect button the bot answers an
 * unconnected account with, sent the browser to Microsoft's `common`
 * endpoint, which Microsoft refuses for such an app (AADSTS50194). Nobody
 * could connect, and the bot kept answering `oncall` with "Connect your
 * Microsoft Teams account to see who is on call."
 *
 * These go the whole way through the real code, with Microsoft played by
 * FakeMicrosoftIdentityPlatform, which refuses `common` for a single-tenant
 * app as Microsoft does:
 *
 *   the Dashboard asks GET /api/microsoft-teams/sign-in-url   (real router)
 *     -> the browser at Microsoft's authorize URL             (the fake)
 *     -> Microsoft sends it to GET /api/microsoft-teams/auth  (real router)
 *     -> the code exchanged, /me read                        (the fake)
 *     -> the account linked                                  (an in-memory table)
 *   and then the bot, through the REAL botbuilder CloudAdapter and a fake
 *   Bot Connector (as in MicrosoftTeamsCommandsEndToEnd), answering
 *   `oncall` from that Teams account.
 *
 * The cases: a self-hosted server's single-tenant app; OneUptime Cloud's
 * multitenant app, with a member of a customer's organization, a guest of
 * it and somebody of neither; a project not connected yet; no tenant
 * configured at all; the Connect button pressed in Teams; and a project
 * connected to another organization while somebody signed in.
 */

jest.mock("botbuilder", () => {
  const nodeModuleBuiltin: typeof import("module") =
    typeof process.getBuiltinModule === "function"
      ? process.getBuiltinModule("module")
      : Object.getPrototypeOf(jest.requireActual("module"));

  return nodeModuleBuiltin.createRequire(__filename)("botbuilder");
});

/*
 * MICROSOFT_TEAMS_APP_TENANT_ID differs per case, so it is a getter over
 * state the test sets (the API reads it as a property of this module each
 * time). The client id and secret are the same app's in every case; what
 * kind of app it is lives in the fake's registration.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const settings: { appTenantId: string | null } = { appTenantId: null };

  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80",
    MicrosoftTeamsAppClientSecret: "teams-client-secret",
    setMockMicrosoftTeamsAppTenantId: (tenantId: string | null): void => {
      settings.appTenantId = tenantId;
    },
  };

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

import API from "../../../Utils/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../Types/Workspace/ConnectCallback";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import {
  AppApiClientUrl,
  DashboardClientUrl,
} from "../../../Server/EnvironmentConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectRequest from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
} from "botbuilder";
import FakeMicrosoftIdentityPlatform, {
  FAKE_GRAPH_ME_URL,
  FakeAccount,
  FakeAppRegistration,
  FakeAuthorizeOutcome,
  FakeSignInAudience,
  FakeTokenRequest,
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

// ---- Microsoft: the apps, the organizations, the people ----

const CLIENT_ID: string = "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80";
const CLIENT_SECRET: string = "teams-client-secret";

// The organization a self-hosted OneUptime serves; its app is registered here.
const CONTOSO: string = "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11";
// Where OneUptime Cloud's multitenant app is registered.
const ONEUPTIME_CLOUD: string = "4220aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
// A customer of OneUptime Cloud, whose project is connected to Microsoft Teams.
const FABRIKAM: string = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
// Another organization: a Fabrikam guest's own, and somebody else's.
const NORTHWIND: string = "6c3e2b1a-0f9e-4d8c-b7a6-5f4e3d2c1b0a";

const REDIRECT_URIS: Array<string> = [
  `${AppApiClientUrl.toString()}/microsoft-teams/auth`,
  `${AppApiClientUrl.toString()}/microsoft-teams/admin-consent/callback`,
];

// What the self-hosted guide registers: "Accounts in this organizational directory only".
const SELF_HOSTED_APP: FakeAppRegistration = {
  name: "oneuptime",
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  homeTenantId: CONTOSO,
  signInAudience: FakeSignInAudience.SingleTenant,
  redirectUris: REDIRECT_URIS,
};

// OneUptime Cloud's app, which every customer's organization consents to.
const CLOUD_APP: FakeAppRegistration = {
  ...SELF_HOSTED_APP,
  name: "OneUptime",
  homeTenantId: ONEUPTIME_CLOUD,
  signInAudience: FakeSignInAudience.MultiTenant,
};

const ADA_AT_CONTOSO: FakeAccount = {
  person: "ada",
  tenantId: CONTOSO,
  objectId: "a0a0a0a0-0000-4000-8000-000000000001",
  displayName: "Ada Lovelace",
  mail: "ada@contoso.com",
  userPrincipalName: "ada@contoso.com",
  isGuest: false,
};

const GRACE_AT_FABRIKAM: FakeAccount = {
  person: "grace",
  tenantId: FABRIKAM,
  objectId: "f0f0f0f0-0000-4000-8000-000000000002",
  displayName: "Grace Hopper",
  mail: "grace@fabrikam.com",
  userPrincipalName: "grace@fabrikam.com",
  isGuest: false,
};

// Lin works at Northwind, and is a guest in Fabrikam's organization.
const LIN_AT_NORTHWIND: FakeAccount = {
  person: "lin",
  tenantId: NORTHWIND,
  objectId: "b0b0b0b0-0000-4000-8000-000000000003",
  displayName: "Lin Chen",
  mail: "lin@northwind.com",
  userPrincipalName: "lin@northwind.com",
  isGuest: false,
};

const LIN_GUEST_AT_FABRIKAM: FakeAccount = {
  person: "lin",
  tenantId: FABRIKAM,
  objectId: "c0c0c0c0-0000-4000-8000-000000000004",
  displayName: "Lin Chen (Northwind)",
  mail: "lin@northwind.com",
  userPrincipalName: "lin_northwind.com#EXT#@fabrikam.onmicrosoft.com",
  isGuest: true,
};

// Mallory is in no organization a project here is connected to.
const MALLORY_AT_NORTHWIND: FakeAccount = {
  person: "mallory",
  tenantId: NORTHWIND,
  objectId: "d0d0d0d0-0000-4000-8000-000000000005",
  displayName: "Mallory",
  mail: "mallory@northwind.com",
  userPrincipalName: "mallory@northwind.com",
  isGuest: false,
};

// ---- OneUptime ----

const SIGN_IN_START: string = "/api/microsoft-teams/sign-in-url";
const SIGN_IN_CALLBACK: string = "/api/microsoft-teams/auth";
const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;
const DASHBOARD_URL: string = DashboardClientUrl.toString();
const HANDOFF: Date = new Date("2026-10-23T17:00:00.000Z");

const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

type Browser = Record<string, string>;

type SetAppTenantIdFunction = (tenantId: string | null) => void;

function setAppTenantId(tenantId: string | null): void {
  (
    jest.requireMock("../../../Server/EnvironmentConfig") as {
      setMockMicrosoftTeamsAppTenantId: SetAppTenantIdFunction;
    }
  ).setMockMicrosoftTeamsAppTenantId(tenantId);
}

// ---- A fake Bot Connector: records every activity the bot sends ----

const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;

interface ConnectorPost {
  conversationId: string;
  activity: JSONObject;
}

interface FakeBotConnector {
  serviceUrl: string;
  posts: Array<ConnectorPost>;
  close: () => Promise<void>;
}

async function startFakeBotConnector(): Promise<FakeBotConnector> {
  let messageNumber: number = 0;

  const fake: FakeBotConnector = {
    serviceUrl: "",
    posts: [],
    close: async (): Promise<void> => {
      return undefined;
    },
  };

  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      let bodyText: string = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        bodyText += chunk;
      });
      req.on("end", () => {
        const path: string = (req.url || "/").split("?")[0] || "/";
        const match: RegExpExecArray | null = ACTIVITIES_PATH.exec(path);

        if ((req.method === "POST" || req.method === "PUT") && match) {
          messageNumber++;
          fake.posts.push({
            conversationId: decodeURIComponent(match[1] || ""),
            activity: JSON.parse(bodyText || "{}") as JSONObject,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: `msg-${messageNumber}` }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NotFound" } }));
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  fake.serviceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  fake.close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  };

  return fake;
}

// What Teams gets back for the activity it posted.
class RecordingResponse {
  public statusCode: number | null = null;
  public body: unknown = undefined;
  public headersSent: boolean = false;

  public status(code: number): this {
    this.statusCode = code;
    return this;
  }

  public send(body?: unknown): this {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public json(body?: unknown): this {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public end(): this {
    this.headersSent = true;
    return this;
  }

  public header(): this {
    return this;
  }

  public setHeader(): this {
    return this;
  }
}

type CachedAdapterSlot = { cachedAdapter: CloudAdapter | null };

// ---- Per test ----

let app: RunningApp;
let connector: FakeBotConnector;
let microsoft: FakeMicrosoftIdentityPlatform;
let projectId: ObjectID;
let userId: ObjectID;
let activityCounter: number = 0;

// The project's Microsoft Teams connection: the tenant admin consent bound, or none.
let connectedTenantId: string | null = null;

// WorkspaceUserAuthToken, as the sign-in writes it and the bot reads it.
interface LinkRow {
  projectId: string;
  userId: string;
  workspaceUserId: string;
}

let links: Array<LinkRow> = [];

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

function signedInHeaders(): Record<string, string> {
  return {
    [TEST_USER_HEADER]: userId.toString(),
    tenantid: projectId.toString(),
    [TEST_PERMISSIONS_HEADER]: [Permission.ProjectMember].join(","),
  };
}

interface StartedSignIn {
  authorizationUrl: string;
  browser: Browser;
}

// The Dashboard's Connect button: asks OneUptime where to send the browser.
async function startSignIn(
  query?: Record<string, string>,
): Promise<StartedSignIn> {
  const search: string = query
    ? `?${new URLSearchParams(query).toString()}`
    : "";
  const response: ProbeResponse = await httpGet({
    port: app.port,
    path: `${SIGN_IN_START}${search}`,
    headers: signedInHeaders(),
  });

  expect(response.status).toBe(200);

  return {
    authorizationUrl: (response.body as JSONObject)[
      "authorizationUrl"
    ] as string,
    browser: { [COOKIE_NAME]: response.setCookies[COOKIE_NAME]! },
  };
}

// The authority a Microsoft URL names: a tenant, `common` or `organizations`.
function authorityOf(url: string): string {
  return new globalThis.URL(url).pathname.split("/")[1] || "";
}

/*
 * A URL OneUptime or the fake wrote, split at its query: the address as
 * written, and the query read. Never parsed as a whole - a test server's
 * URLs may have no host (HOST is unset outside CI).
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

// Microsoft sends the browser back to OneUptime: the callback, with the browser's cookie.
function comeBack(
  redirectTo: string,
  browser: Browser,
): Promise<ProbeResponse> {
  const target: { address: string; query: URLSearchParams } =
    splitUrl(redirectTo);

  expect(target.address).toBe(REDIRECT_URIS[0]);

  return httpGet({
    port: app.port,
    path: `${SIGN_IN_CALLBACK}?${target.query.toString()}`,
    headers: { cookie: cookieHeader(browser) },
  });
}

interface Connected {
  started: StartedSignIn;
  atMicrosoft: FakeAuthorizeOutcome;
  // OneUptime's answer to the callback; null when Microsoft never sent the browser back.
  callback: ProbeResponse | null;
}

// "Connect my account with Microsoft Teams", signed in to Microsoft as `person`.
async function connectAs(
  person: string,
  query?: Record<string, string>,
): Promise<Connected> {
  const started: StartedSignIn = await startSignIn(query);
  const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
    started.authorizationUrl,
    person,
  );

  return {
    started,
    atMicrosoft,
    callback: atMicrosoft.redirectTo
      ? await comeBack(atMicrosoft.redirectTo, started.browser)
      : null,
  };
}

function teamsPage(
  startPage: "settings" | "user-settings" = "settings",
): string {
  return `${DASHBOARD_URL}/${projectId.toString()}/${startPage}/microsoft-teams-integration`;
}

function linkedObjectIds(): Array<string> {
  return links.map((row: LinkRow) => {
    return row.workspaceUserId;
  });
}

// ---- The bot ----

interface TeamsSender {
  account: FakeAccount;
  // Teams' own id for the person in the conversation.
  teamsId: string;
}

function personalMessage(text: string, sender: TeamsSender): JSONObject {
  activityCounter++;

  return {
    type: "message",
    id: `5202-${activityCounter}-${ObjectID.generate().toString().substring(0, 8)}`,
    timestamp: "2026-10-23T10:00:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: {
      id: sender.teamsId,
      name: sender.account.displayName,
      aadObjectId: sender.account.objectId,
    },
    conversation: {
      conversationType: "personal",
      tenantId: sender.account.tenantId,
      id: `a:5202-personal-${sender.account.objectId}`,
    },
    recipient: { id: "28:oneuptime-bot", name: "OneUptime" },
    textFormat: "plain",
    locale: "en-US",
    text: text,
    entities: [],
    channelData: { tenant: { id: sender.account.tenantId } },
  };
}

// The text of the bot's answer card, after the mention of whoever asked.
async function botAnswers(
  text: string,
  sender: TeamsSender,
): Promise<{
  answer: string;
  connectUrl: string | null;
}> {
  const first: number = connector.posts.length;
  const res: RecordingResponse = new RecordingResponse();

  await MicrosoftTeamsUtil.processBotActivity(
    {
      method: "POST",
      headers: {},
      body: personalMessage(text, sender),
    } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
  );

  expect(res.statusCode).toBe(200);

  const posts: Array<ConnectorPost> = connector.posts.slice(first);
  expect(posts).toHaveLength(1);

  const card: JSONObject = (
    posts[0]!.activity["attachments"] as Array<JSONObject>
  )[0]!["content"] as JSONObject;
  const texts: Array<string> = (card["body"] as Array<JSONObject>)
    .filter((element: JSONObject): boolean => {
      return element["type"] === "TextBlock";
    })
    .map((element: JSONObject): string => {
      return String(element["text"]);
    });
  const mention: string = `<at>${sender.account.displayName}</at> `;

  expect(texts[0]!.startsWith(mention)).toBe(true);

  const button: JSONObject | undefined = (
    (card["actions"] as Array<JSONObject> | undefined) || []
  ).find((action: JSONObject): boolean => {
    return action["title"] === "Connect Microsoft Teams account";
  });

  return {
    answer: texts[0]!.substring(mention.length),
    connectUrl: button ? String(button["url"]) : null,
  };
}

const CONNECT_TO_SEE_ON_CALL: string =
  "🔗 **Connect your Microsoft Teams account to see who is on call.** It takes one click. Then type **oncall** again.";

function expectOnCallNow(answer: string): void {
  expect(answer.split("\n")[0]).toBe("👥 **On call now**");
  expect(answer).toContain("**Simon Lee** until");
}

// ---- Lifecycle ----

beforeAll(async () => {
  connector = await startFakeBotConnector();
  app = await startApp([new MicrosoftTeamsAPI().getRouter()]);
}, 600000);

afterAll(async () => {
  await app.close();
  await connector.close();
});

beforeEach(() => {
  mockCacheStore.clear();
  connector.posts.splice(0);
  microsoft = new FakeMicrosoftIdentityPlatform();

  for (const account of [
    ADA_AT_CONTOSO,
    GRACE_AT_FABRIKAM,
    LIN_AT_NORTHWIND,
    LIN_GUEST_AT_FABRIKAM,
    MALLORY_AT_NORTHWIND,
  ]) {
    microsoft.addAccount(account);
  }

  projectId = ObjectID.generate();
  userId = ObjectID.generate();
  connectedTenantId = null;
  links = [];
  setAppTenantId(null);

  // Every request to Microsoft goes to the fake.
  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data: JSONObject;
  }) => {
    return microsoft.token(options.url.toString(), options.data);
  }) as never);
  jest.spyOn(API, "get").mockImplementation((async (options: {
    url: URL;
    headers?: Record<string, string>;
  }) => {
    return microsoft.readProfile(options.url.toString(), options.headers);
  }) as never);

  // The project's Microsoft Teams connection, as the API and the bot read it.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation(async () => {
      return connection();
    });
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async (options: { query: JSONObject }) => {
      const row: WorkspaceProjectAuthToken | null = connection();

      return row &&
        String(options.query["workspaceProjectId"] || "") ===
          row.workspaceProjectId
        ? [row]
        : [];
    }) as never);

  // WorkspaceUserAuthToken: what the sign-in writes, and the bot reads.
  jest
    .spyOn(WorkspaceUserAuthTokenService, "refreshAuthToken")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        userId: ObjectID;
        workspaceUserId: string;
      }) => {
        links = links.filter((row: LinkRow) => {
          return !(
            row.projectId === data.projectId.toString() &&
            row.userId === data.userId.toString()
          );
        });
        links.push({
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
          workspaceUserId: data.workspaceUserId,
        });
      },
    );
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockImplementation((async (options: { query: JSONObject }) => {
      const query: JSONObject = options.query;
      const row: LinkRow | undefined = links.find((link: LinkRow) => {
        return (
          (query["projectId"] === undefined ||
            String(query["projectId"]) === link.projectId) &&
          (query["workspaceUserId"] === undefined ||
            String(query["workspaceUserId"]) === link.workspaceUserId) &&
          (query["userId"] === undefined ||
            String(query["userId"]) === link.userId)
        );
      });

      if (!row) {
        return null;
      }

      const token: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      token.userId = new ObjectID(row.userId);
      token.workspaceUserId = row.workspaceUserId;
      return token;
    }) as never);

  // Whoever signs in is a member of the project, and stays one.
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation(
      async (data: {
        userId: ObjectID;
        projectId: ObjectID;
      }): Promise<DatabaseCommonInteractionProps> => {
        return { userId: data.userId, tenantId: data.projectId };
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

  // The bot: the real CloudAdapter, anonymous, posting to the fake Bot Connector.
  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter =
    new CloudAdapter(new ConfigurationBotFrameworkAuthentication({}));
  jest
    .spyOn(
      MicrosoftTeamsUtil as unknown as {
        captureChatFromBotActivity: () => Promise<void>;
      },
      "captureChatFromBotActivity",
    )
    .mockResolvedValue(undefined);
  jest
    .spyOn(MicrosoftTeamsUtil, "captureTeamFromBotActivity")
    .mockResolvedValue(undefined);

  // Who is on call: one schedule, read as the member.
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockImplementation((async () => {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule.id = ObjectID.generate();
      schedule.name = "Primary";
      const simon: User = new User();
      simon.id = ObjectID.generate();
      simon.name = new Name("Simon Lee");
      schedule.currentUserOnRoster = simon;
      schedule.rosterHandoffAt = HANDOFF;
      return [schedule];
    }) as never);

  jest.spyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(() => {
    return Promise.resolve(URL.fromString(DASHBOARD_URL));
  });
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter = null;
  jest.restoreAllMocks();
});

// The token requests the sign-in made, by the authority each went to.
function tokenAuthorities(): Array<string> {
  return microsoft.tokenRequests.map((request: FakeTokenRequest) => {
    return request.authority;
  });
}

// ---- Tests ----

describe("a self-hosted server, its app registered for one organization as the guide says", () => {
  beforeEach(() => {
    microsoft.registerApp(SELF_HOSTED_APP);
    setAppTenantId(CONTOSO);
    connectedTenantId = CONTOSO;
  });

  test("the fake refuses common for this app as Microsoft does: AADSTS50194, sent back to OneUptime, which links nothing", async () => {
    const { authorizationUrl, browser } = await startSignIn();
    const commonUrl: globalThis.URL = new globalThis.URL(authorizationUrl);
    commonUrl.pathname = "/common/oauth2/v2.0/authorize";

    const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
      commonUrl.toString(),
      "ada",
    );

    // What #5202's server log shows: back to the callback, with the error.
    const back: URLSearchParams = splitUrl(atMicrosoft.redirectTo!).query;
    expect(back.get("error")).toBe("invalid_request");
    expect(back.get("error_description")).toContain(
      "AADSTS50194: Application '3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80'(oneuptime) is not configured as a multi-tenant application. Usage of the /common endpoint is not supported for such applications",
    );

    const callback: ProbeResponse = await comeBack(
      atMicrosoft.redirectTo!,
      browser,
    );

    // "Microsoft Teams was not connected. OneUptime could not finish connecting."
    expect(callback.status).toBe(302);
    expect(callback.location).toBe(`${teamsPage()}?error=could-not-finish`);
    expect(callback.location).not.toContain("AADSTS");
    expect(links).toEqual([]);
    expect(microsoft.tokenRequests).toEqual([]);
  });

  test("Connect my account goes to the organization, never common: Ada is linked as Contoso's account", async () => {
    const connected: Connected = await connectAs("ada");

    expect(authorityOf(connected.started.authorizationUrl)).toBe(CONTOSO);
    expect(connected.atMicrosoft.errorPage).toBeNull();

    // Back on the Microsoft Teams page with nothing to say: connected.
    expect(connected.callback!.status).toBe(302);
    expect(connected.callback!.location).toBe(teamsPage());

    // The code exchanged where Microsoft issued it, once.
    expect(tokenAuthorities()).toEqual([CONTOSO]);
    expect(microsoft.tokenRequests[0]!.status).toBe(200);

    expect(links).toEqual([
      {
        projectId: projectId.toString(),
        userId: userId.toString(),
        workspaceUserId: ADA_AT_CONTOSO.objectId,
      },
    ]);
  });

  test("the bot: asked to connect before, and who is on call after", async () => {
    const ada: TeamsSender = { account: ADA_AT_CONTOSO, teamsId: "29:ada" };

    expect((await botAnswers("oncall", ada)).answer).toBe(
      CONNECT_TO_SEE_ON_CALL,
    );

    await connectAs("ada");

    expectOnCallNow((await botAnswers("oncall", ada)).answer);
  });

  test("a project not connected yet: the sign-in goes to the tenant the app is registered in, and the page is told consent is still needed", async () => {
    connectedTenantId = null;

    const connected: Connected = await connectAs("ada");

    expect(authorityOf(connected.started.authorizationUrl)).toBe(CONTOSO);
    expect(tokenAuthorities()).toEqual([CONTOSO]);
    expect(connected.callback!.location).toBe(
      `${teamsPage()}?needAdminConsent=true`,
    );
    expect(linkedObjectIds()).toEqual([ADA_AT_CONTOSO.objectId]);
  });

  test("from User Settings: the same tenant, and back to the person's own Microsoft Teams page", async () => {
    const connected: Connected = await connectAs("ada", {
      from: "user-settings",
    });

    expect(authorityOf(connected.started.authorizationUrl)).toBe(CONTOSO);
    expect(connected.callback!.location).toBe(teamsPage("user-settings"));
    expect(linkedObjectIds()).toEqual([ADA_AT_CONTOSO.objectId]);
  });

  test("the Connect button the bot answered with: pressed, signed in at the organization, the press spent, then oncall", async () => {
    const ada: TeamsSender = { account: ADA_AT_CONTOSO, teamsId: "29:ada" };
    const prompt: { answer: string; connectUrl: string | null } =
      await botAnswers("oncall", ada);

    expect(prompt.answer).toBe(CONNECT_TO_SEE_ON_CALL);

    // The button opens the person's own Microsoft Teams page, with the press.
    const buttonUrl: { address: string; query: URLSearchParams } = splitUrl(
      prompt.connectUrl!,
    );
    expect(buttonUrl.address).toBe(teamsPage("user-settings"));
    const token: string = buttonUrl.query.get("connect")!;
    expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

    // The page starts the sign-in with it, as ConnectRequestNotice does.
    const connected: Connected = await connectAs("ada", {
      from: "user-settings",
      connect: token,
    });

    expect(authorityOf(connected.started.authorizationUrl)).toBe(CONTOSO);
    expect(connected.callback!.location).toBe(
      `${teamsPage("user-settings")}?pressed=run`,
    );
    expect(linkedObjectIds()).toEqual([ADA_AT_CONTOSO.objectId]);

    // The press is spent, and the page asks Ada to type oncall again.
    expect(await WorkspaceConnectRequest.peek(token)).toBeNull();

    expectOnCallNow((await botAnswers("oncall", ada)).answer);
  });
});

describe("OneUptime Cloud: a multitenant app, and a customer's project connected to its own organization", () => {
  beforeEach(() => {
    microsoft.registerApp(CLOUD_APP);
    // Cloud's app is registered in OneUptime's own tenant, not the customer's.
    setAppTenantId(ONEUPTIME_CLOUD);
    connectedTenantId = FABRIKAM;
  });

  test("a member: signed in at the customer's organization - not OneUptime's, not common - and linked as its account", async () => {
    const connected: Connected = await connectAs("grace");

    expect(authorityOf(connected.started.authorizationUrl)).toBe(FABRIKAM);
    expect(tokenAuthorities()).toEqual([FABRIKAM]);
    expect(connected.callback!.location).toBe(teamsPage());
    expect(linkedObjectIds()).toEqual([GRACE_AT_FABRIKAM.objectId]);

    expectOnCallNow(
      (
        await botAnswers("oncall", {
          account: GRACE_AT_FABRIKAM,
          teamsId: "29:grace",
        })
      ).answer,
    );
  });

  test("a guest: linked as the guest account Fabrikam holds for them - the one Teams sends from Fabrikam - so the bot knows them", async () => {
    const linGuest: TeamsSender = {
      account: LIN_GUEST_AT_FABRIKAM,
      teamsId: "29:lin",
    };

    expect((await botAnswers("oncall", linGuest)).answer).toBe(
      CONNECT_TO_SEE_ON_CALL,
    );

    const connected: Connected = await connectAs("lin");

    expect(authorityOf(connected.started.authorizationUrl)).toBe(FABRIKAM);
    expect(connected.callback!.location).toBe(teamsPage());
    expect(linkedObjectIds()).toEqual([LIN_GUEST_AT_FABRIKAM.objectId]);
    expect(linkedObjectIds()).not.toContain(LIN_AT_NORTHWIND.objectId);

    expectOnCallNow((await botAnswers("oncall", linGuest)).answer);
  });

  test("why not common: there a guest signs in to their home organization, as an account the bot never sees", async () => {
    // The URL the sign-in used to build, followed through by hand.
    const { authorizationUrl } = await startSignIn();
    const commonUrl: globalThis.URL = new globalThis.URL(authorizationUrl);
    commonUrl.pathname = "/common/oauth2/v2.0/authorize";

    const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
      commonUrl.toString(),
      "lin",
    );
    const code: string = splitUrl(atMicrosoft.redirectTo!).query.get("code")!;
    const token: HTTPResponse<JSONObject> | HTTPErrorResponse = microsoft.token(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        grant_type: "authorization_code",
        code: code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URIS[0]!,
      },
    );
    const profile: HTTPResponse<JSONObject> | HTTPErrorResponse =
      microsoft.readProfile(FAKE_GRAPH_ME_URL, {
        Authorization: `Bearer ${String(token.data["access_token"])}`,
      });

    // Northwind's account: not the one Teams sends from Fabrikam's organization.
    expect(profile.data["id"]).toBe(LIN_AT_NORTHWIND.objectId);
    expect(profile.data["id"]).not.toBe(LIN_GUEST_AT_FABRIKAM.objectId);
  });

  test("somebody of neither organization is stopped by Microsoft, and nothing is linked", async () => {
    const connected: Connected = await connectAs("mallory");

    expect(authorityOf(connected.started.authorizationUrl)).toBe(FABRIKAM);
    expect(connected.atMicrosoft).toEqual({
      redirectTo: null,
      errorPage: "AADSTS50020",
    });
    expect(connected.callback).toBeNull();
    expect(microsoft.tokenRequests).toEqual([]);
    expect(links).toEqual([]);
  });

  test("the guest's Connect button: the account that pressed it is the one that signs in, so the press is finished", async () => {
    const linGuest: TeamsSender = {
      account: LIN_GUEST_AT_FABRIKAM,
      teamsId: "29:lin",
    };
    const prompt: { answer: string; connectUrl: string | null } =
      await botAnswers("oncall", linGuest);
    const token: string = splitUrl(prompt.connectUrl!).query.get("connect")!;

    const connected: Connected = await connectAs("lin", {
      from: "user-settings",
      connect: token,
    });

    // At common it would be Northwind's account, refused as not the presser.
    expect(authorityOf(connected.started.authorizationUrl)).toBe(FABRIKAM);
    expect(connected.callback!.location).toBe(
      `${teamsPage("user-settings")}?pressed=run`,
    );
    expect(linkedObjectIds()).toEqual([LIN_GUEST_AT_FABRIKAM.objectId]);
    expect(await WorkspaceConnectRequest.peek(token)).toBeNull();

    expectOnCallNow((await botAnswers("oncall", linGuest)).answer);
  });

  test("a project not connected yet has no organization of its own: the sign-in goes to the app's tenant, which a customer is not in", async () => {
    connectedTenantId = null;

    const connected: Connected = await connectAs("grace");

    // The Dashboard offers no sign-in before consent; started some other way, Microsoft stops it.
    expect(authorityOf(connected.started.authorizationUrl)).toBe(
      ONEUPTIME_CLOUD,
    );
    expect(connected.atMicrosoft.errorPage).toBe("AADSTS50020");
    expect(links).toEqual([]);
  });
});

describe("no tenant configured at all", () => {
  beforeEach(() => {
    setAppTenantId(null);
    connectedTenantId = null;
  });

  test("a multitenant app: Microsoft's endpoint for any organization, and its code exchanged there", async () => {
    microsoft.registerApp(CLOUD_APP);

    const connected: Connected = await connectAs("grace");

    expect(authorityOf(connected.started.authorizationUrl)).toBe(
      "organizations",
    );
    expect(tokenAuthorities()).toEqual(["organizations"]);
    expect(linkedObjectIds()).toEqual([GRACE_AT_FABRIKAM.objectId]);
  });

  test("a single-tenant app: organizations is for multitenant apps (the fake refuses it as AADSTS50194) - why the guide asks for MICROSOFT_TEAMS_APP_TENANT_ID", async () => {
    microsoft.registerApp(SELF_HOSTED_APP);

    const connected: Connected = await connectAs("ada");

    expect(authorityOf(connected.started.authorizationUrl)).toBe(
      "organizations",
    );
    expect(connected.callback!.location).toBe(
      `${teamsPage()}?error=could-not-finish`,
    );
    expect(microsoft.tokenRequests).toEqual([]);
    expect(links).toEqual([]);
  });

  test("a connected project needs none: its own tenant", async () => {
    microsoft.registerApp(SELF_HOSTED_APP);
    connectedTenantId = CONTOSO;

    const connected: Connected = await connectAs("ada");

    expect(authorityOf(connected.started.authorizationUrl)).toBe(CONTOSO);
    expect(linkedObjectIds()).toEqual([ADA_AT_CONTOSO.objectId]);
  });
});

describe("the code is exchanged where the sign-in started, and nowhere else", () => {
  test("a project connected to another organization while somebody signed in: nothing is exchanged or linked", async () => {
    microsoft.registerApp(CLOUD_APP);
    setAppTenantId(ONEUPTIME_CLOUD);
    connectedTenantId = FABRIKAM;

    const started: StartedSignIn = await startSignIn();
    const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
      started.authorizationUrl,
      "grace",
    );

    // Uninstalled, and connected to Northwind, before Grace came back.
    connectedTenantId = NORTHWIND;

    const callback: ProbeResponse = await comeBack(
      atMicrosoft.redirectTo!,
      started.browser,
    );

    expect(callback.location).toBe(`${teamsPage()}?error=teams-other-tenant`);
    expect(microsoft.tokenRequests).toEqual([]);
    expect(links).toEqual([]);
  });

  test("a code is redeemed only at the authority that issued it: the fake refuses any other, and OneUptime redeems it there", async () => {
    microsoft.registerApp(CLOUD_APP);
    connectedTenantId = FABRIKAM;

    const started: StartedSignIn = await startSignIn();
    const atMicrosoft: FakeAuthorizeOutcome = microsoft.authorize(
      started.authorizationUrl,
      "grace",
    );
    const code: string = splitUrl(atMicrosoft.redirectTo!).query.get("code")!;

    const elsewhere: HTTPResponse<JSONObject> | HTTPErrorResponse =
      microsoft.token(
        `https://login.microsoftonline.com/common/oauth2/v2.0/token`,
        {
          grant_type: "authorization_code",
          code: code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URIS[0]!,
        },
      );

    expect(elsewhere).toBeInstanceOf(HTTPErrorResponse);

    // OneUptime itself redeems it where it was issued, and it works.
    const callback: ProbeResponse = await comeBack(
      atMicrosoft.redirectTo!,
      started.browser,
    );

    expect(callback.location).toBe(teamsPage());
    expect(tokenAuthorities()).toEqual(["common", FABRIKAM]);
    expect(linkedObjectIds()).toEqual([GRACE_AT_FABRIKAM.objectId]);
  });
});
